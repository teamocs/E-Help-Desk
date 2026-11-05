# Hosting and data safety notes (draft, 2026-11-06)

Parked until the client's hosting or Cloudflare is configured. Current work stays on `/helpdesk/` on both staging sites.

## Status
- `helpdesk.<domain>` subdomains are created for both hotels. AutoSSL cannot be run from our cPanel access for the new subdomains (certificate problem), so they are not usable yet. Revisit when the client has set up hosting or Cloudflare (Cloudflare can issue the certificate in front of the host).
- Same-account subdomains give partial isolation only (same server user). A separate hosting account later gives real isolation; the design allows it.

## Already in the plugin
Least-privilege roles, sign-in lockouts, reset rate limits, PIN shared phones with 12 h acting token, strict CSP and no-store on /helpdesk/, server-side role checks on every command, Staff phones off by default, data kept on plugin deletion unless switched on.

## To do on the server (cPanel)
1. Bare WordPress on helpdesk.<domain>: own database and user, only this plugin, comments and XML-RPC off, no user enumeration, COOKIE_DOMAIN unset.
2. HTTPS: certificate on the subdomain, force HTTPS, HSTS.
3. Strong unique admin password with 2FA; admin username different from the public site; no test users left.
4. Permissions 640 files / 750 folders; no PHP execution in uploads; open_basedir if allowed; DISALLOW_FILE_EDIT.
5. Daily off-server backups (database and files), 14 days kept, one test restore.
6. ModSecurity on (off only for a plugin upload).
7. SMTP for resets and alerts (still open).
8. PHP 8.1+, WordPress minor auto-updates.

## Not built yet
Host check for helpdesk./stay., appliance mode, audit trail for account and list changes, guest routes and retention purge, self-hosted update channel.

## Client decisions
Retention period; what guests may type (no passport or payment data); who holds admin and cPanel credentials; incident plan (revoking a lost phone or PIN).

Order when resumed: harden and back up, host check and appliance mode, audit trail before go-live, separate account if isolation is wanted.
