"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// Privacy Policy — Broker OS
// Compliant with the Indian Information Technology Act, 2000 (and SPDI Rules, 2011)
// and aligned with the core principles of the EU GDPR (lawful basis, data
// subject rights, breach notification, retention minimisation).
// ─────────────────────────────────────────────────────────────────────────────

const LAST_UPDATED = "1 November 2025";
const SUPPORT_EMAIL = "support@broker-os.com";

type Section = {
  n: string;
  title: string;
  body: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    n: "1",
    title: "Information We Collect",
    body: (
      <div className="space-y-3">
        <p>
          We collect only the information necessary to provide and improve the
          Service. The categories of data we process are:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Account data</strong> — your name, email address and a
            salted hash of your password (managed by Supabase Auth; we never see
            the plaintext password).
          </li>
          <li>
            <strong>Business data</strong> — the records you create within the
            Service, such as clients, suppliers, visits, purchase orders,
            dispatches, bills, payments, brokerage entries and uploaded photos.
          </li>
          <li>
            <strong>Usage data</strong> — anonymous page views, feature usage,
            device type and approximate location (city-level) used to improve
            the product. We do <strong>not</strong> use cross-site tracking
            pixels.
          </li>
          <li>
            <strong>Billing data</strong> — collected and processed directly by
            Stripe; we receive only a tokenised reference and the last four
            digits of your card, never the full card number.
          </li>
        </ul>
      </div>
    ),
  },
  {
    n: "2",
    title: "How We Use Your Information",
    body: (
      <div className="space-y-3">
        <p>We process personal data for the following lawful purposes:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To provide the Service you requested, including authentication, data storage and calculations.</li>
          <li>To process subscription payments and issue invoices and receipts.</li>
          <li>To send you service notifications, billing alerts and security notices.</li>
          <li>To provide technical support and respond to your enquiries.</li>
          <li>To improve, debug and secure the Service (aggregated and anonymised analytics).</li>
          <li>To comply with our legal, regulatory and tax obligations under Indian law.</li>
        </ul>
        <p>
          We process this information on the basis of the contract with you
          (performance), our legitimate interests in operating and securing the
          Service, and to comply with legal obligations. Where we rely on
          legitimate interests, we balance those against your rights and the
          minimum data necessary is used.
        </p>
      </div>
    ),
  },
  {
    n: "3",
    title: "Data Storage",
    body: (
      <div className="space-y-3">
        <p>
          Your data is stored with the following trusted providers, all of which
          are GDPR-compliant:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Supabase</strong> — authentication and PostgreSQL database,
            hosted in the Tokyo (ap-northeast-1) region.
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and edge delivery,
            with global CDN and serverless functions.
          </li>
          <li>
            <strong>Local uploads</strong> — photos you attach to records are
            stored on the application server&rsquo;s filesystem under{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/public/uploads</code>{" "}
            (migrable to S3 in future).
          </li>
        </ul>
        <p>
          All data is encrypted <strong>in transit</strong> using HTTPS/TLS 1.2+
          and <strong>at rest</strong> using provider-managed encryption
          (AES-256 for Supabase Postgres, AES-256 for Vercel storage). Backups,
          where maintained by the providers, are equally encrypted.
        </p>
      </div>
    ),
  },
  {
    n: "4",
    title: "Third-Party Services",
    body: (
      <div className="space-y-3">
        <p>
          We rely on the following third parties to operate the Service. Each
          acts as an independent data processor under their own privacy policy:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Supabase</strong> — authentication and database.
            <a
              href="https://supabase.com/privacy"
              target="_blank"
              rel="noreferrer noopener"
              className="ml-1 font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              supabase.com/privacy
            </a>
          </li>
          <li>
            <strong>Stripe</strong> — payment processing.
            <a
              href="https://stripe.com/privacy"
              target="_blank"
              rel="noreferrer noopener"
              className="ml-1 font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              stripe.com/privacy
            </a>
          </li>
          <li>
            <strong>Vercel</strong> — hosting and edge delivery.
            <a
              href="https://vercel.com/legal/privacy-policy"
              target="_blank"
              rel="noreferrer noopener"
              className="ml-1 font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              vercel.com/legal/privacy-policy
            </a>
          </li>
        </ul>
        <p>
          We do not transfer your personal data outside these providers. Where
          Supabase (Tokyo) processes data of Indian residents, the transfer is
          covered by Supabase&rsquo;s standard contractual clauses.
        </p>
      </div>
    ),
  },
  {
    n: "5",
    title: "Data Sharing",
    body: (
      <div className="space-y-3">
        <p>
          <strong>We do not sell your personal data.</strong> We share it only in
          the following limited situations:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Service providers</strong> — Supabase, Stripe and Vercel, to
            the extent necessary to operate authentication, billing and hosting.
          </li>
          <li>
            <strong>Legal compliance</strong> — where compelled by Indian law,
            regulation, court order, or government request, and only the minimum
            data necessary is disclosed.
          </li>
          <li>
            <strong>Business transfers</strong> — in the event of a merger,
            acquisition, or asset sale, your data may be transferred to the
            successor entity, subject to continued compliance with this Policy.
          </li>
        </ul>
        <p>
          We never share your business data (clients, POs, brokerage, photos)
          with any third party for marketing, advertising, or analytics
          purposes.
        </p>
      </div>
    ),
  },
  {
    n: "6",
    title: "Data Retention",
    body: (
      <div className="space-y-3">
        <p>
          We retain your data only for as long as necessary to provide the
          Service and comply with our legal obligations:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Active accounts</strong> — Your Data is retained while your
            account is active and for the duration of your subscription.
          </li>
          <li>
            <strong>Account deletion</strong> — On account deletion, Your Data
            is <strong>permanently deleted within 30 days</strong>, including
            photos, database records and backups within the providers&rsquo;
            retention windows.
          </li>
          <li>
            <strong>Audit logs</strong> — Immutable audit logs of financial
            mutations (payments, billing adjustments, brokerage) are retained
            for <strong>1 year</strong> after deletion for dispute resolution
            and statutory compliance under Indian accounting rules.
          </li>
          <li>
            <strong>Billing records</strong> — Invoices and tax records are
            retained for <strong>7 years</strong> as required by Indian GST and
            Income Tax law.
          </li>
        </ul>
      </div>
    ),
  },
  {
    n: "7",
    title: "User Rights",
    body: (
      <div className="space-y-3">
        <p>
          Under the Indian IT Act / SPDI Rules and the EU GDPR, you have the
          following rights over your personal data:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Access</strong> — request a copy of the personal data we hold about you.</li>
          <li><strong>Export</strong> — download Your Data in a portable, machine-readable format (CSV/JSON) from Settings.</li>
          <li><strong>Correction</strong> — rectify inaccurate or incomplete personal data.</li>
          <li><strong>Deletion</strong> — request erasure of your personal data (the &ldquo;right to be forgotten&rdquo;).</li>
          <li><strong>Objection</strong> — object to processing based on legitimate interests.</li>
          <li><strong>Withdrawal of consent</strong> — where processing is based on consent, withdraw it at any time.</li>
        </ul>
        <p>
          To exercise any of these rights, email{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          with the subject line &ldquo;Data Rights Request&rdquo;. We will verify
          your identity and respond within 30 days, free of charge (unless the
          request is manifestly unfounded or excessive).
        </p>
      </div>
    ),
  },
  {
    n: "8",
    title: "Cookies",
    body: (
      <div className="space-y-3">
        <p>
          We use only essential cookies necessary for the Service to function:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Authentication cookies</strong> — a session token managed by
            Supabase Auth, required to keep you signed in.
          </li>
          <li>
            <strong>Preference cookies</strong> — your selected theme (light /
            dark) and language (English / Hindi / Gujarati).
          </li>
        </ul>
        <p>
          We do <strong>not</strong> use advertising, tracking or third-party
          analytics cookies. No personal data is shared with advertising
          networks. You may clear cookies at any time from your browser; the
          Service will simply prompt you to sign in again.
        </p>
      </div>
    ),
  },
  {
    n: "9",
    title: "Security",
    body: (
      <div className="space-y-3">
        <p>
          We implement industry-standard technical and organisational measures
          to protect your data:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Encrypted authentication via Supabase Auth with salted password hashing (bcrypt).</li>
          <li>Row-level security on the database so each broker can access only their own tenant.</li>
          <li>Rate limiting on authentication and public API endpoints to prevent abuse.</li>
          <li>Append-only audit logging for every financial mutation.</li>
          <li>HTTPS/TLS 1.2+ for all traffic; AES-256 at rest.</li>
          <li>Quarterly security reviews and prompt patching of disclosed vulnerabilities.</li>
        </ul>
        <p>
          No system is perfectly secure. In the event of a personal data breach
          affecting your rights, we will notify you and the relevant authority
          within 72 hours, as required under GDPR Article 33 and the Indian SPDI
          Rules.
        </p>
      </div>
    ),
  },
  {
    n: "10",
    title: "Children's Privacy",
    body: (
      <div className="space-y-3">
        <p>
          The Service is a business tool and is <strong>not intended for
          individuals under 18 years of age</strong>. We do not knowingly
          collect personal data from children. If we become aware that a child
          has provided us with personal data, we will delete it promptly. If you
          believe a child has registered, please contact{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    ),
  },
  {
    n: "11",
    title: "Changes to This Policy",
    body: (
      <div className="space-y-3">
        <p>
          We may update this Privacy Policy from time to time. We will notify
          registered users by email and an in-app banner at least{" "}
          <strong>30 days before</strong> the new Policy takes effect, except
          for changes required by law or that broaden user rights, which may
          take effect immediately.
        </p>
        <p>
          Your continued use of the Service after the effective date
          constitutes acceptance of the revised Policy. The &ldquo;Last
          updated&rdquo; date at the top of this page reflects the most recent
          revision.
        </p>
      </div>
    ),
  },
  {
    n: "12",
    title: "Contact",
    body: (
      <div className="space-y-3">
        <p>
          For any questions, requests, or complaints regarding this Privacy
          Policy or your personal data, contact our Data Protection Officer at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            {SUPPORT_EMAIL}
          </a>
          , or write to:
        </p>
        <address className="not-italic text-foreground/80">
          Broker OS Technologies Pvt. Ltd. <br />
          Attn: Data Protection Officer <br />
          Surat Textile Market, Ring Road <br />
          Surat — 395002, Gujarat, India
        </address>
      </div>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {/* ───────── Hero / header ───────── */}
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          className="glass-strong mb-8 rounded-2xl p-6 sm:p-8"
        >
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400">
              <Shield className="size-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Privacy Policy
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                How Broker OS collects, uses and protects your data.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
                  <Shield className="size-3.5" />
                  Last updated: {LAST_UPDATED}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 font-medium text-muted-foreground ring-1 ring-border/60">
                  Indian IT Act · GDPR-aligned
                </span>
              </div>
            </div>
          </div>
        </motion.header>

        {/* ───────── Legal body ───────── */}
        <article className="space-y-8">
          {SECTIONS.map((s, i) => (
            <motion.section
              key={s.n}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{
                duration: 0.3,
                delay: Math.min(i * 0.02, 0.1),
                ease: [0.2, 0.8, 0.2, 1],
              }}
              className="glass rounded-2xl p-5 sm:p-7"
            >
              <h2 className="mb-3 flex items-baseline gap-3 text-lg font-semibold tracking-tight sm:text-xl">
                <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  {s.n}.
                </span>
                <span>{s.title}</span>
              </h2>
              <div className="space-y-3 text-sm leading-relaxed text-foreground/80 sm:text-[15px] sm:leading-relaxed">
                {s.body}
              </div>
            </motion.section>
          ))}
        </article>

        {/* ───────── Footer / contact + back ───────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="mt-10 flex flex-col items-center justify-between gap-4 sm:flex-row"
        >
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="size-4 text-emerald-600 dark:text-emerald-400" />
            Privacy questions?{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/landing">
              <ArrowLeft className="size-4" />
              Back to home
            </Link>
          </Button>
        </motion.div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Broker OS Technologies Pvt. Ltd. All rights reserved.
        </p>
      </div>
    </main>
  );
}
