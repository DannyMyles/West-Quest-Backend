import nodemailer from "nodemailer";

const kes = (n) => `KES ${Number(n).toLocaleString("en-KE")}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Plain-text + HTML body for a "new application" email. */
export function applicationEmail(application, storeName) {
  const p = application.product;
  const text = [
    `New ${storeName} application ${application.ref}`,
    "",
    `${p.name} (${p.sku}) — ${application.tier.toUpperCase()} plan, ${application.termMonths} months`,
    `Deposit: ${kes(application.depositAmount)}  ·  Daily: ${kes(application.dailyAmount)}  ·  RRP: ${kes(application.rrp)}`,
    "",
    `Customer: ${application.customer.name} · ${application.customer.phone}`,
    application.customer.location ? `Location: ${application.customer.location}` : null,
    application.customer.idNumber ? `ID number: ${application.customer.idNumber}` : null,
    application.notes ? `Notes: ${application.notes}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const html =
    `<h2>New ${esc(storeName)} application ${esc(application.ref)}</h2>` +
    `<p><b>${esc(p.name)}</b> (${esc(p.sku)}) — ${esc(application.tier.toUpperCase())} plan, ${application.termMonths} months</p>` +
    `<p>Deposit: ${esc(kes(application.depositAmount))} · Daily: ${esc(kes(application.dailyAmount))} · RRP: ${esc(kes(application.rrp))}</p>` +
    `<p>${esc(application.customer.name)} · ${esc(application.customer.phone)}</p>`;
  return { subject: `New application ${application.ref} — ${p.name}`, text, html };
}

/** Plain-text + HTML body for a "new cash order" email. */
export function orderEmail(order, storeName) {
  const lines = order.items.map((i) => `${i.quantity} × ${i.name} (${i.sku}) — ${kes(i.unitPrice * i.quantity)}`);
  const text = [
    `New ${storeName} cash order ${order.ref}`,
    "",
    ...lines,
    `Total: ${kes(order.total)}`,
    "",
    `Customer: ${order.customer.name} · ${order.customer.phone}`,
    order.customer.location ? `Location: ${order.customer.location}` : null,
    order.notes ? `Notes: ${order.notes}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
  const html =
    `<h2>New ${esc(storeName)} cash order ${esc(order.ref)}</h2>` +
    `<ul>${order.items.map((i) => `<li>${i.quantity} × ${esc(i.name)} — ${esc(kes(i.unitPrice * i.quantity))}</li>`).join("")}</ul>` +
    `<p><b>Total: ${esc(kes(order.total))}</b></p>` +
    `<p>${esc(order.customer.name)} · ${esc(order.customer.phone)}</p>`;
  return { subject: `New cash order ${order.ref} — ${kes(order.total)}`, text, html };
}

/**
 * Application and order alerts. Never throws and never delays submission: failures are
 * logged and dropped. `transport` is injectable for tests; without SMTP +
 * recipients this is a no-op.
 */
export function createNotifier(config, { transport, log = console } = {}) {
  const { to, smtp, from, storeName } = config.notify;
  const enabled = to.length > 0 && (transport || smtp);
  const mailer = enabled ? (transport ?? nodemailer.createTransport(smtp)) : null;

  return {
    enabled: Boolean(enabled),
    applicationSubmitted(application) {
      if (!mailer) return;
      const { subject, text, html } = applicationEmail(application, storeName);
      Promise.resolve()
        .then(() => mailer.sendMail({ from, to: to.join(", "), subject, text, html }))
        .catch((err) => log.error(`Application alert for ${application.ref} failed: ${err.message}`));
    },
    orderPlaced(order) {
      if (!mailer) return;
      const { subject, text, html } = orderEmail(order, storeName);
      Promise.resolve()
        .then(() => mailer.sendMail({ from, to: to.join(", "), subject, text, html }))
        .catch((err) => log.error(`Order alert for ${order.ref} failed: ${err.message}`));
    },
  };
}
