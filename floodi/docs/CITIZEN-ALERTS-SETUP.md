# Citizen email alerts: Resend pilot setup

The email pilot is deployed and **enabled as of October 20, 2026**, after the owner confirmed receipt of the provider test and requested deployment. New users must explicitly consent and verify email; previous early-access registrations are never automatically activated. Billing remains disabled. The configuration instructions below still use delivery off as the safe preparation default.

## Current testing setup — October 20, 2026

The owner approved `alerts@895forsale.com` as the temporary test sender. Resend verified the domain for sending, the key is stored in the existing project's `CITIZEN_ALERT_RESEND_API_KEY` Secret Manager secret, and the deployed server configuration uses that sender with delivery explicitly `true`. All four consumers bind the existing server secret.

One owner-authorized connection email was submitted to the owner's Gmail address. Resend accepted it, reported `delivered`, and the owner confirmed receipt. This direct provider connection check did not enroll a citizen, run the deployed worker, exercise unsubscribe or deploy the app. A real consent/verification/worker/opt-out test remains the next pilot acceptance check; do not treat the direct provider test as that end-to-end result. Use a dedicated FloodCast domain for the public launch when available.

## Configure the sender

1. Use a domain/subdomain you own, add it in Resend, and complete its DNS verification. Choose a plain sender address on that verified domain; a personal Gmail address is not an owned sending domain. Follow [Resend's domain setup](https://resend.com/docs/dashboard/domains/introduction).
2. Create a Resend sending API key, restricting it to the intended sending domain where available. Keep it out of frontend configuration, source control, shell history and logs.
3. From the app directory, an authorized operator can store the key interactively in the **existing** Firebase project's Secret Manager:

   ```sh
   firebase functions:secrets:set CITIZEN_ALERT_RESEND_API_KEY --project floodcastwebapp
   ```

   This command changes production configuration; it is a later activation step, not a prerequisite for deploying the disabled early-access release. Functions use their runtime identity for the bound secret; no service-account key belongs in the browser. See [Firebase secret configuration](https://firebase.google.com/docs/functions/config-env#secret-manager).

## Nonsecret settings

Merge [the example](../functions/src/citizenAlerts/.env.example) into the existing `functions/.env.<project-id>`; preserve existing settings. The nested example is not automatically loaded by Firebase.

```dotenv
CITIZEN_ALERT_DELIVERY_ENABLED=false
CITIZEN_ALERT_PROVIDER=resend
CITIZEN_ALERT_FROM_EMAIL=alerts@YOUR_VERIFIED_DOMAIN
CITIZEN_ALERT_PUBLIC_URL=https://floodcastwebapp.web.app
```

Replace the sender placeholder with a verified address. Keep the flag `false` during preparation. The API key is supplied through Secret Manager, **not** this file. The site URL must be an HTTPS origin without a path, query or fragment.

After provider/domain setup and release approval, change the flag to `true` and deploy all four consumers together: `citizenAlerts`, `queueCitizenFloodAlerts`, `queueCitizenAlertEnrollment`, and `deliverCitizenFloodAlerts`. Activation binds `CITIZEN_ALERT_RESEND_API_KEY` to those runtimes; the disabled deployment binds no secret and requires none to exist. Secret rotation also requires redeploying all consumers. Deploy the two `citizen_alert_outbox` composite indexes in `firestore.indexes.json` and wait for them to be ready before enabling the worker. Hosting must route `/api/alerts` to `citizenAlerts` and serve `/alerts/unsubscribe` as an app route.

## Verify with a consenting resident

1. Use an email account controlled by the tester, explicitly join the email pilot, and complete Firebase email verification. Refresh verification in the Alerts page, then confirm enrollment/enable alerts. The backend reads current Admin Auth email and verification; client-editable profiles and old token verification claims cannot activate delivery.
2. Confirm **Active** status and request **Send test alert**. Only one test per account per hour is accepted. A test queues a message; it does not send synchronously with the HTTP request. The enabled worker runs every minute. A new active enrollment can also receive the current usable upcoming flood event, if one exists.
3. Match the private history/outbox record and provider message ID, inspect the Resend event, and verify receipt in the actual inbox. History state `sent` means **accepted by the provider**, not proof of inbox delivery. No successful real send or deliverability claim should be recorded until this check is performed.
4. Pause alerts, confirm no queued message for the previous enrollment generation can start a send, then explicitly resume. Test the email's unsubscribe link and confirm **Unsubscribed**. Opening the link only shows confirmation: unsubscribe requires an explicit POST. Its opaque capability is carried in a fragment and stripped before app analytics; GET requests never unsubscribe. An older enrollment's link cannot revoke a later explicit re-enrollment.
5. Check `citizen_alert_delivery_failed`, `citizen_alert_delivery_rejected`, `citizen_alert_fanout_failed`, and `citizen_alert_request_failed` in Cloud Logging/monitoring. Logs contain sanitized categories/statuses, not recipient addresses, tokens, provider response bodies or keys.

Early-access records are never automatically promoted when the operator enables Resend. Residents must explicitly confirm enrollment again. There is no charge, SMS, push notification, street-specific policy or paid entitlement in this pilot.

## Delivery and forecast limits

- Citizen delivery uses separate private records; original shadow decisions retain `delivery: not-attempted` and zero recipients. Current gauge/reference compatibility, observation age, issue age, latest processed publication, consent, account verification and enrollment generation are rechecked before provider submission. Missing evidence stays unresolved. A pending enrollment is retried until it sees a usable forecast, including a valid dry forecast.
- Only the near-term alert policy is used: up to 6 hours for residual-response and 24 hours for weather-response, subject to actual coverage/freshness. The dashboard's longer planning horizon does not become an equally reliable alert promise. Gauge threshold exceedance is not verified street depth or road clearance.
- Messages expire after at most 30 minutes in the delivery queue (15 minutes for tests), with at most five attempts and 90-second leases. Stable provider idempotency keys protect ambiguous retries; Resend retains them for 24 hours. See [Resend idempotency behavior](https://resend.com/docs/dashboard/emails/idempotency-keys). In-flight duplicate conflicts retry; a changed payload under the same key fails rather than generating a duplicate message.
- The small-pilot worker selects up to 15 due messages plus 5 expired leases per minute. Watch backlog/expiry before inviting a larger population; increase and measure capacity before promising municipality-scale delivery. Pause/unsubscribe prevents subsequent submissions; a provider submission already in flight may finish.
- API acceptance is not a deliverability guarantee. Automated bounce/complaint webhooks, sustained delivery SLOs, retention cleanup and billing are not implemented here. Review actual provider events and subscriber data retention before broad commercialization. Email/consent/history and unsubscribe capabilities remain private server records under default-deny Firestore rules.

To stop delivery immediately, pause the existing Cloud Scheduler job for `deliverCitizenFloodAlerts`. Set the server flag back to `false` and redeploy all consumers for a durable stop; keep early-access signup and opt-out available. Do not delete or alter historical shadow/forecast records to silence failures.
