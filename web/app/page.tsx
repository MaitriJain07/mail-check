import Link from 'next/link';
import { TryIt } from '@/components/TryIt';
import { btnPrimary, Logo } from '@/components/ui';
import { API_URL } from '@/lib/api';

const STEPS = [
  { n: '01', title: 'Syntax', body: 'RFC-reasonable format and length limits. Case and whitespace are normalised.' },
  { n: '02', title: 'Disposable', body: 'Matched against a bundled list of 600+ throwaway providers, subdomains included.' },
  { n: '03', title: 'MX lookup', body: 'Real DNS with a timeout and a per-domain cache. No mail servers means no mail.' },
  { n: '04', title: 'Role account', body: 'Flags shared inboxes like admin@, info@ and support@ that rarely convert.' },
  { n: '05', title: 'SMTP handshake', body: 'Asks the mail server whether the mailbox exists, then hangs up without sending anything.' },
  { n: '06', title: 'Catch-all', body: 'Probes a random mailbox. If the server accepts it, a "yes" for your address means nothing.' },
];

const CURL = `curl "${API_URL}/v1/verify?email=jane@acme.com" \\
  -H "X-API-Key: mc_live_..."`;

const SAMPLE = `{
  "email": "jane@acme.com",
  "result": "deliverable",
  "reason": "Mailbox exists and accepts mail",
  "checks": {
    "syntax":     { "status": "pass" },
    "disposable": { "status": "pass" },
    "mx":         { "status": "pass", "detail": "mx1.acme.com" },
    "role":       { "status": "pass" },
    "smtp":       { "status": "pass", "detail": "250 OK" },
    "catchAll":   { "status": "pass" }
  },
  "score": 100,
  "durationMs": 412
}`;

export default function Landing() {
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-[15px] sm:gap-2">
          <a href={`${API_URL}/docs`} className="rounded-lg px-3 py-2 font-medium text-muted hover:text-ink">API docs</a>
          <Link href="/login" className="rounded-lg px-3 py-2 font-medium text-muted hover:text-ink">Log in</Link>
          <Link href="/register" className={`${btnPrimary} hidden sm:inline-flex`}>Get 100 free credits</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-14">
          <div className="lg:pt-6">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 font-mono text-xs text-muted">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" /> six checks, one request
            </p>
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Know if an email is real <span className="text-brand">before</span> you hit send.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              Stop bounces, fake signups and burned sender reputation. MailCheck verifies an address the way a mail server would, and shows its work.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/register" className={btnPrimary}>Start free, 100 credits</Link>
              <a href={`${API_URL}/docs`} className="inline-flex items-center rounded-lg px-3 py-2.5 text-[15px] font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-brand">
                Read the API docs
              </a>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-white/60 p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-muted">Try it live</h2>
            <TryIt />
          </div>
        </section>

        <section className="border-y border-line bg-white/50">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">What happens in a check</h2>
            <p className="mt-2 max-w-2xl text-muted">Each step runs in order and stops at the first decisive failure, so bad addresses are cheap to reject.</p>
            <ol className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="border-t border-ink/80 pt-3">
                  <p className="font-mono text-sm text-brand">{s.n}</p>
                  <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-3xl font-semibold tracking-tight">One call. Every check, itemised.</h2>
          <p className="mt-2 max-w-2xl text-muted">Single lookups, bulk CSV jobs, per-key rate limits and a usage ledger. Documented with OpenAPI.</p>
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <pre className="overflow-x-auto rounded-xl bg-ink p-5 font-mono text-[13px] leading-relaxed text-[#e8efe9]" aria-label="curl example"><code>{CURL}</code></pre>
            <pre className="overflow-x-auto rounded-xl bg-ink p-5 font-mono text-[13px] leading-relaxed text-[#e8efe9]" aria-label="example response"><code>{SAMPLE}</code></pre>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <Logo />
          <p>A portfolio project: Node.js, TypeScript, MySQL, Next.js.</p>
        </div>
      </footer>
    </>
  );
}
