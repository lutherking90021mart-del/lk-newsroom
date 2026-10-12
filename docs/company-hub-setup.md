# LK Newsroom Company Hub setup

The company hub lives at `/pages/company.html` and is proposed in pull request #4. It is intentionally kept on the feature branch until reviewed.

## Enable the AI assistant

Add these environment variables to the Node server hosting LK Newsroom:

- `OPENAI_API_KEY`: a secret API key created in the OpenAI API platform. Keep it in the server environment; never put it in HTML or browser JavaScript.
- `OPENAI_CHAT_MODEL`: optional; defaults to `gpt-4o-mini`.

The hub sends visitor questions to `POST /v1/company/chat`. The server limits question length, rate-limits requests by IP, and uses a constrained LK Newsroom support prompt. If the key is missing, the page falls back to its prepared answers and WhatsApp handoff. Configure API billing/limits before enabling it in production.

## Add staff members and photos

No additional staff names or contact details were supplied when this page was prepared, so only the company lead is listed by name. Do not invent staff profiles.

For each staff member, collect and approve:
- Full name and role/title
- A professional portrait the person has permission to publish
- Work email and/or public work telephone number
- Optional short biography or department

In `pages/company.html`, duplicate a `.person` card in the `#team` section. Replace the placeholder avatar with an image such as:

```html
<div class="avatar"><img src="../assets/team/staff-name.webp" alt="Portrait of Staff Name" loading="lazy"></div>
```

Put approved portraits under `assets/team/` (prefer WebP or JPEG, crop to a square, and compress for web). Use a descriptive alt attribute. Do not publish private phone numbers or personal email addresses without the staff member's approval.

## Contact form behavior

The current form opens the visitor's email application with a prefilled message. It does not store submissions on the server. To build a true shared enquiry inbox later, add server-side validation, spam protection, delivery and retention policies before switching the form to server submission.

## Payment safety

The payment details on the page are displayed as provided by the site owner. Because the bank and Mobile Money recipient names differ, customers are instructed to confirm the recipient and amount against an approved quote/invoice before transferring. Do not represent manual transfer payments as automatically verified.
