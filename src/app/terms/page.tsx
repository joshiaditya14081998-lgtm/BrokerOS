"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { FileText, Shield, ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// Terms of Service — Broker OS
// Legal copy for a SaaS operated from Surat, Gujarat, India serving garment brokers.
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
    title: "Acceptance of Terms",
    body: (
      <div className="space-y-3">
        <p>
          By accessing or using <strong>Broker OS</strong> (the &ldquo;Service&rdquo;),
          operated by Broker OS Technologies Pvt. Ltd. (&ldquo;Broker OS&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;), you agree to be
          bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree
          with any part of these Terms, you must not access or use the Service.
        </p>
        <p>
          These Terms form a legally binding agreement between you and Broker OS
          governing your use of the Service. Creating an account, signing in, or
          using any feature of the Service constitutes acceptance of these Terms.
        </p>
      </div>
    ),
  },
  {
    n: "2",
    title: "Description of Service",
    body: (
      <div className="space-y-3">
        <p>
          Broker OS is a cloud-based operations platform purpose-built for garment
          brokers. The Service enables users to manage the full lifecycle of a
          broking business, including:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Clients and suppliers (parties) with contact details and ledgers.</li>
          <li>Market visits and the suppliers visited during each trip.</li>
          <li>Purchase orders (POs) raised on behalf of clients.</li>
          <li>Dispatches, deliveries and goods-in-transit tracking.</li>
          <li>Bills, payments and receivable/payable reconciliation.</li>
          <li>Brokerage commission calculation, eligibility and payouts.</li>
          <li>Photo documentation of stock, dispatches and disputes.</li>
          <li>Analytics, reports and a portal for clients and suppliers.</li>
        </ul>
        <p>
          The Service is provided as a multi-tenant software-as-a-service (SaaS)
          hosted on secure cloud infrastructure. We may add, modify, or
          discontinue features from time to time in our discretion.
        </p>
      </div>
    ),
  },
  {
    n: "3",
    title: "Account Registration",
    body: (
      <div className="space-y-3">
        <p>
          To use the Service you must register an account. You agree to:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Provide accurate, current and complete information at registration and keep it updated.</li>
          <li>Be at least 18 years of age and legally able to enter into contracts.</li>
          <li>Use your real name and a valid business email address.</li>
          <li>Keep your password and account credentials strictly confidential.</li>
          <li>Notify us immediately of any unauthorised use of your account.</li>
        </ul>
        <p>
          You are solely responsible for all activity that occurs under your
          account, whether or not you authorised it. Broker OS will not be liable
          for any loss arising from unauthorised access due to your failure to
          safeguard your credentials.
        </p>
      </div>
    ),
  },
  {
    n: "4",
    title: "Subscription & Billing",
    body: (
      <div className="space-y-3">
        <p>
          The Service is offered on a subscription basis. New accounts receive a
          <strong> 14-day free trial</strong> of the Pro plan, after which the
          account converts to the Free plan unless a paid plan is selected.
          Paid plans available at the date of these Terms are:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Basic</strong> — &#8377;999 per month.</li>
          <li><strong>Pro</strong> — &#8377;2,999 per month.</li>
          <li><strong>Enterprise</strong> — &#8377;9,999 per month.</li>
        </ul>
        <p>
          Subscriptions are billed monthly or annually through our payment
          partner, Stripe. Plans <strong>auto-renew</strong> at the end of each
          billing cycle unless cancelled before the renewal date. You may cancel
          your subscription at any time from the billing settings; cancellation
          takes effect at the end of the current paid period.
        </p>
        <p>
          Refunds are governed by Stripe&rsquo;s refund policy and applicable
          Indian law. We do not issue refunds for partial billing periods,
          except where required by law or where a documented service outage has
          materially affected your ability to use the Service. Fees are exclusive
          of applicable taxes (including GST), which are added where required.
        </p>
      </div>
    ),
  },
  {
    n: "5",
    title: "Acceptable Use",
    body: (
      <div className="space-y-3">
        <p>
          You agree not to, and not to permit any third party to:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Use the Service for any unlawful, fraudulent or unauthorised purpose under Indian or applicable foreign law.</li>
          <li>Send unsolicited commercial communications (&ldquo;spam&rdquo;) through the Service.</li>
          <li>Scrape, crawl, or otherwise extract data from the Service or another user&rsquo;s account.</li>
          <li>Share, resell or transfer your account credentials to third parties.</li>
          <li>Reverse engineer, decompile, disassemble or otherwise attempt to derive the source code of the Service.</li>
          <li>Introduce malware, viruses, or any code that interferes with the Service&rsquo;s operation.</li>
          <li>Bypass or attempt to bypass rate limits, authentication, or other security controls.</li>
        </ul>
        <p>
          Violations may result in immediate suspension or termination of your
          account, without refund, and may be reported to the relevant
          authorities where required by law.
        </p>
      </div>
    ),
  },
  {
    n: "6",
    title: "Data Ownership",
    body: (
      <div className="space-y-3">
        <p>
          You retain all right, title and interest in the data you upload to or
          create within the Service, including client records, supplier records,
          purchase orders, bills, payments, brokerage entries, photos and
          reports (&ldquo;Your Data&rdquo;). Broker OS acts as a data processor
          on your behalf.
        </p>
        <p>
          You may <strong>export</strong> Your Data at any time from the
          Settings &rarr; Export screen in CSV/JSON format. You may also
          <strong> permanently delete</strong> Your Data and your account at any
          time from Settings &rarr; Account &rarr; Delete. Deletion is
          irreversible and triggers the retention schedule described in our
          Privacy Policy.
        </p>
      </div>
    ),
  },
  {
    n: "7",
    title: "Privacy",
    body: (
      <div className="space-y-3">
        <p>
          Our collection, use and handling of personal data is described in our{" "}
          <Link
            href="/privacy"
            className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            Privacy Policy
          </Link>
          , which is incorporated into these Terms by reference. For
          transparency, the Service relies on the following third parties:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Supabase</strong> — authentication and PostgreSQL database.</li>
          <li><strong>Stripe</strong> — subscription billing and payment processing.</li>
          <li><strong>Vercel</strong> — application hosting and edge delivery.</li>
        </ul>
      </div>
    ),
  },
  {
    n: "8",
    title: "Intellectual Property",
    body: (
      <div className="space-y-3">
        <p>
          The Service, including its source code, design, branding, logos, and
          documentation, is the intellectual property of Broker OS and is
          protected by Indian and international copyright and trademark laws.
          Nothing in these Terms grants you any right, title or interest in the
          Service other than the limited right to use it per these Terms.
        </p>
        <p>
          You retain all intellectual property rights in Your Data. Broker OS
          receives a limited, non-exclusive licence to use Your Data solely as
          necessary to operate, maintain and improve the Service for you.
        </p>
      </div>
    ),
  },
  {
    n: "9",
    title: "Termination",
    body: (
      <div className="space-y-3">
        <p>
          Either party may terminate this agreement at any time. You may
          terminate by deleting your account from Settings. We may terminate or
          suspend your account if you breach these Terms, if your account is
          inactive for more than 12 consecutive months, or if required by law.
        </p>
        <p>
          Upon termination for any reason, your right to use the Service ends
          immediately. <strong>Your Data will be permanently deleted within
          30 days</strong> of termination, except for audit logs and records
          required to be retained under Indian tax and accounting law, which are
          retained as described in the Privacy Policy.
        </p>
      </div>
    ),
  },
  {
    n: "10",
    title: "Disclaimers",
    body: (
      <div className="space-y-3">
        <p>
          The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; basis. To the fullest extent permitted by law, Broker
          OS disclaims all warranties, express or implied, including
          warranties of merchantability, fitness for a particular purpose, and
          non-infringement.
        </p>
        <p>
          Broker OS does not warrant that the Service will be uninterrupted,
          error-free, or secure, or that brokerage, GST, or other financial
          calculations performed by the Service are accurate. You are solely
          responsible for verifying financial figures before relying on them
          for tax, statutory, or commercial decisions.
        </p>
      </div>
    ),
  },
  {
    n: "11",
    title: "Limitation of Liability",
    body: (
      <div className="space-y-3">
        <p>
          To the fullest extent permitted by law, Broker OS and its affiliates,
          directors, employees, and suppliers shall not be liable for any
          indirect, incidental, special, consequential or punitive damages,
          including lost profits, lost revenue, business interruption, or loss
          of data, arising out of or in connection with the Service.
        </p>
        <p>
          Our aggregate liability for any claim arising out of or relating to
          these Terms or the Service shall not exceed the total subscription
          amount paid by you to Broker OS in the 12 months preceding the event
          giving rise to the claim.
        </p>
      </div>
    ),
  },
  {
    n: "12",
    title: "Governing Law",
    body: (
      <div className="space-y-3">
        <p>
          These Terms are governed by and construed in accordance with the laws
          of the Republic of India. Any dispute arising out of or in connection
          with these Terms shall be subject to the exclusive jurisdiction of the
          courts of <strong>Surat, Gujarat, India</strong>.
        </p>
      </div>
    ),
  },
  {
    n: "13",
    title: "Changes to Terms",
    body: (
      <div className="space-y-3">
        <p>
          We may update these Terms from time to time. We will notify
          registered users by email and by an in-app banner at least{" "}
          <strong>30 days before</strong> the new Terms take effect, except
          for changes required by law or that are beneficial to users, which
          may take effect immediately.
        </p>
        <p>
          Your continued use of the Service after the effective date of any
          revised Terms constitutes your acceptance of the revised Terms. If you
          do not agree to the revised Terms, you must stop using the Service and
          request account deletion as described above.
        </p>
      </div>
    ),
  },
  {
    n: "14",
    title: "Contact",
    body: (
      <div className="space-y-3">
        <p>
          Questions about these Terms may be sent to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            {SUPPORT_EMAIL}
          </a>
          . For postal correspondence, write to Broker OS Technologies Pvt. Ltd.,
          Surat Textile Market, Ring Road, Surat — 395002, Gujarat, India.
        </p>
      </div>
    ),
  },
];

export default function TermsPage() {
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
              <FileText className="size-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Terms of Service
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                The rules that govern your use of Broker OS.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
                  <Shield className="size-3.5" />
                  Last updated: {LAST_UPDATED}
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
            Questions?{" "}
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
