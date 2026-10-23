# LK Newsroom Company Hub setup

The Company Hub lives at `/pages/company.html`. Public reader payments and paid access are disabled; the hub offers only free community submissions, contact information and an optional voluntary-support contact route.

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

## Free access and optional reader support

All public news and features must remain free. The Company Hub no longer publishes bank or Mobile Money details and does not provide reader checkout, paid memberships, subscriptions or paid promotion packages. Readers who wish to support LK Newsroom may contact the team for verified voluntary-support options; support never unlocks content or buys editorial coverage. Do not provide bank/account details, request payments, or ask for PINs, passwords or one-time codes.


## Shared enquiries inbox and staff profiles

1. Open the Supabase project used by LK Newsroom and go to **SQL Editor**.
2. Run `supabase/company-hub-enquiries.sql`. This creates two new tables only: `company_enquiries` and `company_staff_profiles`. It does not overwrite existing news, accounts or articles.
3. Deploy the feature branch through the normal deployment pipeline after review. The public contact form then stores enquiries privately; failed submissions show an email/WhatsApp fallback.
4. Open `/pages/company-inbox.html` and sign in with an existing staff account to review enquiries, add internal notes, change status and reply by email.
5. Open `/pages/company-team-admin.html` to create/edit staff profiles, add portrait HTTPS URLs, set display order and publish/unpublish profiles. Only published profiles appear on the public Company Hub.

The server-side admin endpoints require a valid Supabase session and an editorial role (super admin, admin or editor). The public API never exposes private enquiries or draft staff profiles. Portraits can be hosted in approved public image storage and added by HTTPS URL. Do not publish staff contact details or photos without permission.

The dashboard uses the existing Supabase Auth login. If your hosting configuration uses a separate API origin, set `LK_AGGREGATOR_API_URL` to the backend URL in the public client configuration.
