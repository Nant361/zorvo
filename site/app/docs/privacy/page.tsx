import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { Chip } from "../../../components/ui/Chip";
import { docsMetadata } from "../../../lib/docs-metadata";

export const metadata = docsMetadata("/docs/privacy");

const TOC: TocEntry[] = [
  { id: "sign-in", label: "Sign-in stays with the agents" },
  { id: "hosts", label: "A few hosts, all named" },
  { id: "private-mode", label: "Only while private mode is on" },
  { id: "data", label: "Where your data lives" },
  { id: "folders", label: "Folder limits" },
];

export default function PrivacyPage() {
  return (
    <DocsShell
      current="/docs/privacy"
      title="Privacy and your data"
      lead="Zorvo sends no telemetry, never stores your keys, and says which hosts it contacts."
      toc={TOC}
    >
      <H2 id="sign-in">Sign-in stays with the agents</H2>
      <P>
        The app never asks for or stores API keys or tokens. Agents sign in with their own tools, and pull request data
        comes from your own <Chip isCode>gh</Chip> login.
      </P>
      <P>
        Zorvo asks your <Chip isCode>gh</Chip> whether you are signed in to github.com and reads only your login and
        name, to show them in the sidebar and in Settings. It stores neither, never reads or keeps a token, and
        downloads no picture. <B>Connect</B> runs <Chip isCode>gh auth login</Chip> for github.com in a terminal, and
        you sign in through your browser.
      </P>

      <H2 id="hosts">A few hosts, all named</H2>
      <P>
        Zorvo&apos;s backend contacts these hosts, and only these, unless you turn on private mode (see{" "}
        <DocLink href="#private-mode">Only while private mode is on</DocLink>):
      </P>
      <UL>
        <li>the ACP registry (<Chip isCode>cdn.agentclientprotocol.com</Chip>), to list agents and their versions, and to fetch their logos;</li>
        <li>the download URLs the registry lists, and the HTTPS hosts they redirect to, when you install a binary agent;</li>
        <li><Chip isCode>nodejs.org</Chip>, when you install an agent that needs Node.js and yours is missing or older than 22;</li>
        <li>uv&apos;s releases on GitHub, when you install an agent that runs with <Chip isCode>uvx</Chip> and you have no <Chip isCode>uvx</Chip>;</li>
        <li>
          Zorvo&apos;s own releases on GitHub: <Chip isCode>github.com/zakyirsyaad/zorvo</Chip> to ask whether a
          newer Zorvo exists (a few seconds after start, then about once a day), and, when you click{" "}
          <B>Update &amp; restart</B>, <Chip isCode>api.github.com</Chip> to download it. GitHub sends both requests on to
          its download host, today <Chip isCode>release-assets.githubusercontent.com</Chip>.
        </li>
      </UL>
      <P>
        Every agent and runtime download is checked against a SHA-256 hash that was pinned before the download, and none
        starts until you click <B>Install</B>. A Zorvo update starts only when you click <B>Update &amp; restart</B>, must
        come from Zorvo&apos;s releases, and is installed only if its signature matches the key built into the app. The
        window itself makes no network requests: its Content Security Policy only allows the local IPC bridge.
      </P>
      <P>
        The tools your agents run make their own requests. <Chip isCode>npm</Chip> and <Chip isCode>npx</Chip> fetch
        packages from the npm registry, and <Chip isCode>uvx</Chip> can download Python and PyPI packages. Your agents
        talk to their own services as they always do.
      </P>

      <H2 id="private-mode">Only while private mode is on</H2>
      <P>
        Private mode is off until you turn it on for a Qwen Code session. While it is on, Zorvo&apos;s backend also
        contacts:
      </P>
      <UL>
        <li>
          the Zorvo Credits server (<Chip isCode>zorvo-credits-server.zkyxentertain.workers.dev</Chip>), run by
          zorvolabs, to register this Mac, read your balance, the packs on offer and the models, start and check a
          top-up, set a private session&apos;s spending cap, and move your credits when you use your recovery code on
          another Mac. It never sees your prompts;
        </li>
        <li>
          NEAR AI Cloud (<Chip isCode>cloud-api.near.ai</Chip>). Qwen Code sends its requests to Zorvo&apos;s proxy on
          your Mac, which passes them on to NEAR AI. Zorvo also asks NEAR AI for each answer&apos;s signature and the
          model&apos;s attestation, to show Verified in TEE, reads what each call cost, and checks your own NEAR AI key if
          you add one.
        </li>
      </UL>
      <P>
        Your browser, not Zorvo, opens PingPay&apos;s checkout (<Chip isCode>pay.pingpay.io</Chip>) when you buy credits,
        and NEAR AI&apos;s Verification Center (<Chip isCode>cloud.near.ai/verify</Chip>) when you open it from a
        session. What you pay with stays between you and PingPay. See{" "}
        <DocLink href="/docs/credits">Credits terms</DocLink>.
      </P>

      <H2 id="data">Where your data lives</H2>
      <P>
        Sessions and transcripts are stored in <Chip isCode>~/Library/Application Support/xyz.zorvo.desktop/</Chip>, as{" "}
        <Chip isCode>state.json</Chip> and <Chip isCode>transcripts/</Chip>. Session worktrees live in{" "}
        <Chip isCode>worktrees/</Chip> there. On first launch, Zorvo copies sessions and transcripts from the folder
        earlier builds used and leaves that folder as it was.
      </P>
      <P>
        With private mode on, Zorvo keeps its secrets in your Keychain: the recovery code that identifies this Mac, the
        NEAR AI key the Credits server hands over (or your own key), and the key of each session with a spending cap.
      </P>

      <H2 id="folders">Folder limits</H2>
      <P>The backend only reads and runs in folders you opened in the app.</P>
    </DocsShell>
  );
}
