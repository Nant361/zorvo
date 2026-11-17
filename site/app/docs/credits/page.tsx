import { DocsShell, type TocEntry } from "../../../components/docs/DocsShell";
import { B, DocLink, H2, P, UL } from "../../../components/docs/parts";
import { docsMetadata } from "../../../lib/docs-metadata";
import { LINKS } from "../../../lib/links";

export const metadata = docsMetadata("/docs/credits");

const TOC: TocEntry[] = [
  { id: "seller", label: "Who sells them" },
  { id: "cost", label: "What a credit costs" },
  { id: "paying", label: "Paying" },
  { id: "balance", label: "Your balance" },
  { id: "limits", label: "Limits" },
  { id: "contact", label: "Questions" },
];

// Every statement here is something the app or the credits server already does. What happens to a
// balance if private mode stops is not decided yet, so the page says nothing about it.
// TODO: add that section once zorvolabs decides it.
export default function CreditsPage() {
  return (
    <DocsShell
      current="/docs/credits"
      title="Credits terms"
      lead="What you buy when you buy credits for private mode, what they cost, and what happens to your payment and your balance."
      toc={TOC}
    >
      <H2 id="seller">Who sells them</H2>
      <P>
        Credits are sold by zorvolabs, which runs the credits server behind private mode. They pay for private sessions
        only: Zorvo, and every agent you use in it, stays free whether you buy credits or not.
      </P>

      <H2 id="cost">What a credit costs</H2>
      <P>
        You buy credits at 1 credit = $0.01, and Settings, Private mode lists the packs on offer. A private session
        spends the model&apos;s own price at NEAR AI plus 20%, which covers payments and running the service. Settings
        shows your balance and about how many turns it leaves on each model.
      </P>

      <H2 id="paying">Paying</H2>
      <P>
        Checkout opens in your browser through PingPay. You pay in USDC from any chain, or by card, and Zorvo never sees
        your payment details.
      </P>
      <UL>
        <li>While you pay, your credits are held for 25 minutes. Closing checkout without paying charges nothing.</li>
        <li>If a payment fails, no credits are added. If PingPay received part of it, PingPay handles the refund.</li>
        <li>
          If you pay after the hold ran out and the packs sold out meanwhile, your payment still counts: you are first in
          line when credits are on offer again.
        </li>
        <li>If NEAR AI is slow to answer after you paid, Zorvo keeps trying. Do not pay again.</li>
      </UL>

      <H2 id="balance">Your balance</H2>
      <UL>
        <li>Credits do not expire and cannot be withdrawn.</li>
        <li>
          They work on the Mac that bought them. Your <B>recovery code</B> moves them to another Mac, and the first Mac
          stops using them. Keep the code private: whoever has it can move your credits.
        </li>
        <li>While a Mac pays with your own NEAR AI key, Zorvo credits are not spent, and they stay on that Mac.</li>
      </UL>

      <H2 id="limits">Limits</H2>
      <UL>
        <li>A pack is on offer only while Zorvo&apos;s NEAR AI balance can cover it.</li>
        <li>One Mac holds up to 5,000 credits at a time, counting what it bought and has not spent yet.</li>
        <li>
          You can cap a private session at 100, 200 or 500 credits. NEAR AI stops the session there, even if Zorvo is
          closed.
        </li>
      </UL>

      <H2 id="contact">Questions</H2>
      <P>
        Ask about a payment or your balance in <DocLink href={LINKS.issues}>Zorvo&apos;s issues on GitHub</DocLink>. Say
        when you paid and which pack you picked. Never post your recovery code there, since issues are public.
      </P>
      <P>
        The credits server never sees your prompts. Which hosts Zorvo contacts is in{" "}
        <DocLink href={LINKS.privacyGuide}>Privacy and your data</DocLink>.
      </P>
      <P>Last changed on 17 November 2026.</P>
    </DocsShell>
  );
}
