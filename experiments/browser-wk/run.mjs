import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {startFixture} from './fixture.mjs';

// Deliberately not part of tauri build, pnpm build or the shipped resources.
const dir=path.dirname(fileURLToPath(import.meta.url));
const run=promisify(execFile);
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());
process.once('SIGTERM',()=>controller.abort());
const options={signal:controller.signal,timeout:180_000,maxBuffer:2*1024*1024};
let fixture;
try {
  if(process.platform!=='darwin')throw new Error('This spike requires macOS and Xcode.');
  const flags = process.argv.slice(2);
  if(flags.length > 1 || flags.some(arg => !['--screen-spi', '--restricted'].includes(arg)))throw new Error('Usage: node experiments/browser-wk/run.mjs [--screen-spi | --restricted]');
  const out=await mkdtemp(path.join(os.tmpdir(),'zorvo-browser-wk-'));
  const app=path.join(out,'Zorvo Browser Spike.app');
  const bin=path.join(app,'Contents','MacOS');
  await mkdir(bin,{recursive:true});
  await copyFile(path.join(dir,'Info.plist'),path.join(app,'Contents','Info.plist'));
  const target=process.arch==='arm64'?'arm64-apple-macosx12.0':'x86_64-apple-macosx12.0';
  await run('xcrun',['swiftc','-target',target,'-swift-version','5','-parse-as-library','-warnings-as-errors',path.join(dir,'Probe.swift'),'-o',path.join(bin,'probe'),'-framework','AppKit','-framework','WebKit'],options);
  await run('codesign',['--force','--sign','-',app],options);
  fixture=await startFixture();
  const result=path.join(out,'results.json');
  console.log(`Results: ${result}`);
  if(flags.includes('--restricted')) {
    console.log('The restricted permission checks run automatically.');
  } else {
    console.log('Click Request screen. Cancel any screen picker or OS prompt; do not grant access. Scroll the page, then click Finish checks.');
  }

  const child=await run(path.join(bin,'probe'),[String(fixture.port),result,...flags],options);
  if(child.stderr)process.stderr.write(child.stderr);
  const report=JSON.parse(await readFile(result,'utf8'));
  report.harness={
    collectedAt:new Date().toISOString(),
    arch:process.arch,
    sourceSha256:createHash('sha256').update(await readFile(path.join(dir,'Probe.swift'))).digest('hex'),
    fixtureSha256:createHash('sha256').update(await readFile(path.join(dir,'fixture.mjs'))).digest('hex'),
    screenSPI:flags.includes("--screen-spi"),
    restricted:flags.includes("--restricted"),
  };
  await writeFile(result,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  // Unverified gates are not a green run. This is evidence collection, not a release gate bypass.
  if(report.results.some(row=>row.status!=='pass'))process.exitCode=2;
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally {
  if(fixture)await new Promise(resolve=>fixture.server.close(resolve));
}
