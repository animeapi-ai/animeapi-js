# AnimeAPI SDK for JavaScript and TypeScript

Official SDK for [AnimeAPI](https://animeapi.ai): anime image generation from **$0.003 per image**, one of the cheapest anime image APIs, plus anime video. New accounts get **3 free images, no card**.

Zero dependencies. Works in Node 18+, Bun, Deno, Cloudflare Workers and browsers. Ships ESM, CommonJS and TypeScript types.

```bash
npm install @animeapi/sdk
```

## Quick start

```ts
import AnimeAPI from "@animeapi/sdk";

const client = new AnimeAPI({ apiKey: process.env.ANIMEAPI_API_KEY });
const image = await client.images.generate({ prompt: "a silver-haired girl reading under a cherry tree" });
console.log(image.imageUrl);
```

Create a key (it starts with `ank_`) at <https://animeapi.ai/dashboard/api-keys>. If you leave `apiKey` out, the SDK reads the `ANIMEAPI_API_KEY` environment variable.

## Prices

| Model | Price | Good for |
| --- | --- | --- |
| `anime` (default) | $0.003 per image | Characters and illustrations; plain-English prompts are rewritten into tags |
| `ultra` | $0.01 per image | Long, detailed sentences and legible text |
| `ultra-max` | $0.02 per image | Finest detail and real typography |
| Video, 480p | $0.016 per second | 5 to 15 second clips, 24 fps, with sound |
| Video, 768p | $0.04 per second | 5 to 15 second clips, 24 fps, with sound |

Any orientation costs the same. You pay from a prepaid balance (from $5) that never expires; there is no subscription. New accounts get 3 free images, no card.

## Images

```ts
const image = await client.images.generate({
  prompt: "a knight in ornate armor on a cliff at sunrise",
  model: "anime",            // "anime" | "ultra" | "ultra-max"
  orientation: "landscape",  // "portrait" (default) | "square" | "landscape"
  enhance: true,             // anime model: rewrite the prompt into tags (default true)
});

image.imageUrl;          // https://animeapi.ai/cdn/...
image.enhancedPrompt;    // what the model actually received
image.balanceUsd;        // balance after this charge
image.generationTimeMs;  // about 4 s on anime, about 11 s on ultra
```

`client.generate("a prompt")` is a shortcut with the defaults.

AnimeAPI does not generate adult content. Explicit prompts are refused and not charged.

### Keeping the image

Image URLs are not permanent storage. Download what you want to keep:

```ts
import { writeFile } from "node:fs/promises";

const file = await client.images.download(image);   // { bytes: Uint8Array, contentType }
await writeFile("girl.webp", file.bytes);
```

`anime` returns WebP; `ultra` and `ultra-max` return PNG.

## Video

Video jobs are asynchronous. The price is charged when the job starts and refunded if it fails.

```ts
// Start and wait in one call (a 5 second 480p clip costs $0.08):
const video = await client.videos.createAndWait({
  prompt: "a girl with a red umbrella waits at a rainy bus stop, then looks up as the bus pulls in",
  resolution: "480p",   // "480p" | "768p" (default)
  duration: 5,          // 5 to 15 seconds
  orientation: "landscape",
});
console.log(video.videoUrl);

// Or control the steps yourself:
const job = await client.videos.create({ prompt: "...", resolution: "480p" });
const current = await client.videos.get(job.id);              // status: "processing" | "succeeded" | "failed"
const done = await client.videos.wait(job.id, { intervalMs: 5000, timeoutMs: 600_000 });
const mp4 = await client.videos.download(done);               // { bytes, contentType }
```

Pass `firstFrame` and/or `lastFrame` (an image URL or a base64 data URI, up to 10 MB) to animate from or to an image.

## Models

```ts
const models = await client.models.list();
// [{ id: "anime", description: "... $0.003 per image ..." }, { id: "ultra", ... }, { id: "ultra-max", ... }]
```

## Error handling

Every failure throws an `AnimeAPIError` with `status`, `code` and `retryable`.

```ts
import AnimeAPI, { AnimeAPIError, InsufficientBalanceError, ModerationError } from "@animeapi/sdk";

try {
  await client.images.generate({ prompt });
} catch (err) {
  if (err instanceof InsufficientBalanceError) {
    // top up at https://animeapi.ai/dashboard/billing
  } else if (err instanceof ModerationError) {
    // the prompt was blocked
  } else if (err instanceof AnimeAPIError) {
    console.error(err.status, err.code, err.retryable, err.message);
  } else {
    throw err;
  }
}
```

| Status | `code` | Class | Retried automatically |
| --- | --- | --- | --- |
| 400 | (validation), `PROVIDER_REJECTED`, `INVALID_FRAME` | `InvalidRequestError` | no |
| 400 | `MODERATION_BLOCKED` | `ModerationError` | no |
| 401 | `INVALID_KEY` | `AuthenticationError` | no |
| 402 | `INSUFFICIENT_BALANCE` | `InsufficientBalanceError` | no |
| 404 | `NOT_FOUND` | `NotFoundError` | no |
| 429 | `RATE_LIMITED` | `RateLimitError` | when the API says it is retryable |
| 500 | `GENERATION_FAILED` | `GenerationError` | yes |
| 503 | `PROVIDER_UNAVAILABLE` | `ServiceUnavailableError` | yes, after `Retry-After` |
| none | `CONNECTION_ERROR` | `ConnectionError` | yes |
| none | `TIMEOUT` | `TimeoutError` | no |

A video that finishes with status `failed` throws `VideoFailedError` from `wait` (the charge has been refunded).

### Retries and timeouts

Retryable failures are tried again up to 2 more times with exponential back-off, and the SDK waits for the `Retry-After` header when the API sends one.

```ts
const client = new AnimeAPI({
  apiKey: "ank_...",
  maxRetries: 2,        // 0 turns retries off
  timeoutMs: 120_000,   // per request
  baseURL: "https://animeapi.ai",
  fetch: myFetch,       // bring your own fetch (proxy, instrumentation)
});

// Per request, with cancellation:
const controller = new AbortController();
await client.images.generate({ prompt }, { signal: controller.signal, timeoutMs: 30_000, maxRetries: 0 });
```

## CommonJS

```js
const { AnimeAPI } = require("@animeapi/sdk");
```

## Browsers

The SDK runs in browsers, but a key placed in front-end code can be read by anyone who opens the page. Call AnimeAPI from your server, or from a Worker or edge function, and keep the key there.

## Already using the OpenAI client?

The official `openai` library works too: point its base URL at `https://animeapi.ai/v1`.

```ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.ANIMEAPI_API_KEY, baseURL: "https://animeapi.ai/v1" });
const result = await openai.images.generate({ model: "anime", prompt: "a fox spirit shrine maiden at dusk", size: "1024x1024" });
console.log(result.data[0].url);
```

Only the shape of `size` is used (square, portrait or landscape). `n` can be 1 to 4, and `response_format` can be `url` or `b64_json`.

## Links

- Docs: <https://animeapi.ai/docs>
- API reference: <https://animeapi.ai/docs/api-reference>
- OpenAPI: <https://animeapi.ai/openapi.json>
- Python SDK: <https://github.com/animeapi-ai/animeapi-python>

MIT licence.
