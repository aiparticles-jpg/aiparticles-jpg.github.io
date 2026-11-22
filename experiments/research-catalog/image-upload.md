# Image-only upload APIs and public client keys

Research date: 2026-11-22. Focus: image uploads that can be called directly from a browser without end-user registration, including services that intentionally restrict the free tier to images. This is separate from arbitrary-file relay and from early-readable streaming.

## Executive summary

**Uploadcare Free** is the strongest match for the image-only hypothesis: the official Free plan allows image uploads only, and the browser needs only a project public key when signed uploads are disabled. A documented demo public key also passed a browser-origin upload and CDN retrieval test.

**Cloudinary** provides unsigned upload presets for browser/mobile uploads without a server-generated signature. The preset name is public and can be restricted to image formats. Its free plan is 25 credits/month.

**Imgur** supports anonymous image uploads with a public Client-ID and no end-user login, but the application owner must register an app; free API use is non-commercial and rate-limited.

None of these has demonstrated receiver-readable partial objects while upload is still in progress. They are image object stores/mailboxes, not live streaming relays.

## 1. Uploadcare

- Official site: https://uploadcare.com/
- Pricing: https://uploadcare.com/pricing/
- Upload API: https://uploadcare.com/docs/uploading-files/
- Storage/retention: https://uploadcare.com/docs/uploads/storage/
- API key model: https://help.uploadcare.com/article/318-where-do-i-get-my-api-keys

### Access model
- Every project has a unique public API key. The public key is explicitly designed to be visible in client code and identifies the project.
- A secret key is used for privileged REST API operations, secure uploads/delivery and other protected features.
- Direct browser upload can use the public key alone when signed uploads are disabled.
- Callers do not need Uploadcare accounts; the project owner does.
- Free plan is personal-use only.

### Free plan and image-only restriction
- 1,000 operations/month.
- 5 GB traffic/month.
- 1 GB storage.
- 500 MB maximum file size.
- Free plan supports image uploads only. Uploading other file types requires adding a card for KYC; remaining on the Free plan does not itself create usage charges.
- Files can be uploaded with `UPLOADCARE_STORE=0`; they are deleted after 24 hours. With `UPLOADCARE_STORE=1`, they remain until explicitly deleted.

### Browser test
- Used the official demo public key `demopublickey`, not another user's private key.
- Origin: `https://aiparticles-jpg.github.io`.
- Uploaded a 68-byte PNG to `https://upload.uploadcare.com/base/`.
- Upload returned HTTP 200 and a file UUID.
- CDN GET from `https://ucarecdn.com/<uuid>/` returned HTTP 200, 68 bytes, `image/png`.
- Test run: https://github.com/aiparticles-jpg/aiparticles-jpg.github.io/actions/runs/45024687805
- **Verdict: E3 browser upload + CDN retrieval PASS** for the documented demo key.

### Early-read assessment
- Upload API returns the file UUID after the upload request completes.
- The CDN URL is then available for retrieval; no documented way was found to fetch a partially uploaded original.
- Multipart upload for large files is an upload assembly mechanism, not proof of early-read.
- **Early-read: FAIL/NOT SUPPORTED by documented workflow.**

## 2. Cloudinary

- Official pricing: https://cloudinary.com/pricing
- Upload presets: https://cloudinary.com/documentation/upload_presets
- Upload API: https://cloudinary.com/documentation/upload_images

### Access model
- Owner creates a Cloudinary account, cloud name and upload preset.
- An unsigned preset can be used directly from a browser/mobile client without signature generation or a backend.
- The preset name is public and visible in client code; it is a capability, not a secret.
- Presets can restrict `allowed_formats` to PNG/JPEG/WebP and set incoming transformations. Cloudinary warns that unsigned presets should be protected; the preset itself does not support a per-preset file-size limit.
- End users do not need Cloudinary accounts.

### Free plan
- $0, free forever, no credit card required.
- 25 credits/month.
- One credit is 1 GB storage, or 1 GB image bandwidth, or 1,000 transformations (usage is combined across resources).

### Early-read assessment
- Upload response and asset delivery are available after the upload completes.
- Chunked uploads improve large-upload reliability but no receiver-visible partial object was found.
- **Browser upload: E1 documented. Early-read: UNKNOWN/NOT DOCUMENTED.**
- No live upload test yet; requires an owner-created cloud name and unsigned preset. Do not borrow another developer's preset.

## 3. Imgur

- API docs: https://apidocs.imgur.com/

### Access model
- Owner registers an application and receives a Client-ID and Client Secret.
- Anonymous image uploads do not require end-user OAuth/login; client sends `Authorization: Client-ID <client_id>`.
- Client-ID is intended for client-side identification and is not a private end-user credential.
- Anonymous uploads are not tied to a user's Imgur account; response includes image ID and deletehash.

### Free API limits
- Approximately 1,250 uploads/day and 12,500 API requests/day per application.
- 1,250 POST requests/hour per IP.
- Free API tier is non-commercial; inspect current terms before any product use.

### Early-read assessment
- API returns image ID/link after the upload request finishes.
- No partial image retrieval during upload documented.
- **Browser upload: E1 documented. Early-read: NOT DOCUMENTED.**
- No browser-origin upload test yet; requires our own registered application. Do not reuse another project's Client-ID.

## 4. ImgBB

- API docs: https://api.imgbb.com/
- Public API key required; uploads use multipart form data.
- Image size limit reported as 32 MB; optional expiry from 60 seconds to 180 days.
- Third-party CORS probe reports wildcard CORS, but the official pricing page's API-access entitlement is ambiguous. Treat free API access as **UNKNOWN** until verified.
- No early-read capability found.
- **Priority: P2 / conditional.**

## 5. ImageKit

- Official upload docs: https://imagekit.io/docs/api-reference/upload-file-api/client-side-file-upload
- Public key is client-safe, but secure client-side upload requires a server-generated token/signature.
- Therefore it is not a no-backend public-key-only upload path.
- Free bandwidth/storage may be attractive, but token minting is required.
- **Priority: P2 if a small Worker token endpoint is acceptable.**

## 6. Cloudflare Images Direct Creator Upload

- Docs: https://developers.cloudflare.com/images/upload-images/direct-creator-upload/
- Backend creates a one-time upload URL; browser uploads directly with that bearer capability.
- Good server-secret isolation pattern: App Secret/API token stays in Worker; one-time URL goes to browser.
- Image becomes retrievable after upload finalization; no partial-read support established.
- Requires an owner Cloudflare account and a Worker/token endpoint.
- **Priority: P2 if using our own Worker.**

## 7. Negative / conditional findings

### BasePic
- Free anonymous upload and image API advertised.
- Its documented CORS allowlist is limited to localhost/127.0.0.1 and mobile wrapper origins; arbitrary GitHub Pages origins are not allowed.
- **FAIL_BROWSER for VoiceLink origin.**

### Public demo credentials
Do not reuse random public keys found in repositories as if they were shared community credentials. Distinguish:
- official demo keys intended for documentation/testing (e.g. Uploadcare's `demopublickey`);
- public client identifiers intended to be embedded in client apps (Cloudinary unsigned preset names, Imgur Client-ID);
- privileged admin tokens accidentally published in a sample README (not safe for reuse).

## 8. Image transport conclusion

Image-only APIs are a genuine additional category. Uploadcare Free is a particularly good fit if we only need to store and fetch images, and it offers automatic 24-hour expiry. Cloudinary and Imgur are also viable public-client upload patterns.

However, none of these solves the most valuable latency optimization by itself: the receiving side cannot be assumed to read the image while the sender is still uploading. For that requirement, a live binary transport such as the tested Mazupo SFU DataChannel or CopyPaesto Worker WebSocket relay is stronger. A hybrid is possible: use image hosting for durable/temporary storage and a live transport to send chunks/notify the receiver.
