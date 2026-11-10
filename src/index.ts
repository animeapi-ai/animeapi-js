/**
 * Official AnimeAPI SDK (https://animeapi.ai).
 *
 * Zero dependencies. Uses the platform `fetch`, so it runs in Node 18+, Bun,
 * Deno, Cloudflare Workers and browsers.
 */

export const VERSION = "0.1.1";

const DEFAULT_BASE_URL = "https://animeapi.ai";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `anime` $0.003 per image, `ultra` $0.01, `ultra-max` $0.02. */
export type ImageModel = "anime" | "ultra" | "ultra-max";
export type Orientation = "portrait" | "square" | "landscape";
/** 480p is $0.016 per second, 768p is $0.04 per second. */
export type VideoResolution = "480p" | "768p";
export type VideoStatus = "processing" | "succeeded" | "failed";

export type ErrorCode =
  | "INVALID_KEY"
  | "INSUFFICIENT_BALANCE"
  | "MODERATION_BLOCKED"
  | "INVALID_FRAME"
  | "NOT_FOUND"
  | "GENERATION_FAILED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  // Raised by the SDK itself:
  | "INVALID_REQUEST"
  | "CONNECTION_ERROR"
  | "TIMEOUT"
  | "VIDEO_FAILED"
  | (string & {});

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AnimeAPIOptions {
  /** Your key (starts with `ank_`). Defaults to the `ANIMEAPI_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `https://animeapi.ai`. */
  baseURL?: string;
  /** Custom fetch implementation (proxies, tests, older runtimes). Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** How many times a retryable failure is tried again. Default 2. Set 0 to turn retries off. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 120000. */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** Cancel the request. */
  signal?: AbortSignal;
  /** Override the client's timeout for this request. */
  timeoutMs?: number;
  /** Override the client's retry count for this request. */
  maxRetries?: number;
}

export interface GenerateImageParams {
  /** What to draw, in plain English. Up to 1000 characters. */
  prompt: string;
  /** Default `anime` ($0.003 per image). */
  model?: ImageModel;
  /** Default `portrait`. */
  orientation?: Orientation;
  /** `anime` model only: rewrite the prompt into tags first. Default true. */
  enhance?: boolean;
  /** @deprecated Ignored by the API; adult output is not available. Kept so existing code compiles. */
  allowNSFW?: boolean;
}

export interface GeneratedImage {
  /** Temporary URL of the form https://animeapi.ai/i/<id>.<ext>. Download the image if you need to keep it. */
  imageUrl: string;
  /** What the model actually received. */
  enhancedPrompt: string;
  /** Balance in US dollars after this charge. */
  balanceUsd: number;
  generationTimeMs: number;
}

export interface DownloadedFile {
  bytes: Uint8Array;
  /** For example `image/webp`, `image/png` or `video/mp4`. */
  contentType: string;
}

export interface CreateVideoParams {
  /** What happens in the clip, in plain English. Up to 1000 characters. */
  prompt: string;
  /** Default `768p` ($0.04 per second). `480p` is $0.016 per second. */
  resolution?: VideoResolution;
  /** Whole seconds, 5 to 15. Default 5. */
  duration?: number;
  /** Default `landscape`. Ignored when `firstFrame` is set (the image sets the shape). */
  orientation?: Orientation;
  /** Let the video model expand the prompt first. Default true. */
  enhance?: boolean;
  /** Image the clip starts on: an http(s) URL or a base64 data URI, up to 10 MB. */
  firstFrame?: string;
  /** Image the clip ends on. Same format as `firstFrame`. */
  lastFrame?: string;
}

export interface VideoJob {
  id: string;
  status: "processing";
  pollUrl: string;
  enhancedPrompt: string;
  resolution: VideoResolution;
  duration: number;
  orientation: Orientation;
  /** Charged now; refunded if the job fails. */
  costUsd: number;
  balanceUsd: number;
}

export interface Video {
  id: string;
  status: VideoStatus;
  /** MP4 URL once `status` is `succeeded`. */
  videoUrl: string | null;
  prompt: string;
  enhancedPrompt: string;
  resolution: VideoResolution;
  duration: number;
  orientation: Orientation;
  firstFrame: boolean;
  lastFrame: boolean;
  costUsd: number;
  /** True when the job failed and the charge was returned. */
  refunded: boolean;
  generationTimeMs: number | null;
  /** Why the job failed. */
  error: string | null;
  createdAt: string;
}

export interface WaitOptions {
  /** How often to poll. Default 5000. */
  intervalMs?: number;
  /** Give up after this long. Default 600000 (10 minutes). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called after every poll. */
  onPoll?: (video: Video) => void;
}

export interface Model {
  id: string;
  object: "model";
  created: number;
  ownedBy: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Base class for every error this SDK throws. */
export class AnimeAPIError extends Error {
  /** HTTP status, or 0 when no response was received. */
  readonly status: number;
  /** Machine-readable code such as `INSUFFICIENT_BALANCE`. */
  readonly code: ErrorCode;
  /** True when sending the same request again can succeed. */
  readonly retryable: boolean;
  /** Seconds the server asked you to wait (from `Retry-After`), if any. */
  readonly retryAfter?: number;
  /** The parsed response body, when there was one. */
  readonly body?: unknown;

  constructor(
    message: string,
    init: { status: number; code: ErrorCode; retryable: boolean; retryAfter?: number; body?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
    this.retryAfter = init.retryAfter;
    this.body = init.body;
    if (init.cause !== undefined) (this as { cause?: unknown }).cause = init.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400: the request was invalid, or the model declined it (`PROVIDER_REJECTED`). */
export class InvalidRequestError extends AnimeAPIError {}
/** 400 `MODERATION_BLOCKED`: the prompt was blocked. */
export class ModerationError extends InvalidRequestError {}
/** 401 `INVALID_KEY`: missing, malformed, unknown or revoked key. */
export class AuthenticationError extends AnimeAPIError {}
/** 402 `INSUFFICIENT_BALANCE`: top up at https://animeapi.ai/dashboard/billing. */
export class InsufficientBalanceError extends AnimeAPIError {}
/** 404 `NOT_FOUND`. */
export class NotFoundError extends AnimeAPIError {}
/** 429 `RATE_LIMITED`. */
export class RateLimitError extends AnimeAPIError {}
/** 500 `GENERATION_FAILED`: nothing was charged; retrying is fine. */
export class GenerationError extends AnimeAPIError {}
/** 503 `PROVIDER_UNAVAILABLE`: temporarily unavailable; see `retryAfter`. */
export class ServiceUnavailableError extends AnimeAPIError {}
/** The request never got a response (network failure). */
export class ConnectionError extends AnimeAPIError {}
/** The request, or a video wait, ran out of time. */
export class TimeoutError extends AnimeAPIError {}
/** A video job finished with status `failed` (the charge was refunded). */
export class VideoFailedError extends AnimeAPIError {
  readonly video: Video;
  constructor(video: Video) {
    super(video.error || "The video couldn't be generated.", { status: 200, code: "VIDEO_FAILED", retryable: false });
    this.video = video;
  }
}

function errorFromResponse(status: number, body: unknown, retryAfter: number | undefined): AnimeAPIError {
  const obj = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; retryable?: unknown };
  // The OpenAI-compatible endpoints nest the message: { error: { message, code } }.
  const nested = (obj.error && typeof obj.error === "object" ? obj.error : undefined) as
    | { message?: unknown; code?: unknown }
    | undefined;
  const message =
    typeof obj.error === "string"
      ? obj.error
      : typeof nested?.message === "string"
        ? nested.message
        : `AnimeAPI request failed with status ${status}`;
  const rawCode = typeof obj.code === "string" ? obj.code : typeof nested?.code === "string" ? nested.code : undefined;
  const retryable = typeof obj.retryable === "boolean" ? obj.retryable : status === 500 || status === 503;
  const init = { status, retryable, retryAfter, body };

  if (status === 401) return new AuthenticationError(message, { ...init, code: rawCode ?? "INVALID_KEY" });
  if (status === 402) return new InsufficientBalanceError(message, { ...init, code: rawCode ?? "INSUFFICIENT_BALANCE" });
  if (status === 404) return new NotFoundError(message, { ...init, code: rawCode ?? "NOT_FOUND" });
  if (status === 429) return new RateLimitError(message, { ...init, code: rawCode ?? "RATE_LIMITED" });
  if (status === 503) return new ServiceUnavailableError(message, { ...init, code: rawCode ?? "PROVIDER_UNAVAILABLE" });
  if (status >= 500) return new GenerationError(message, { ...init, code: rawCode ?? "GENERATION_FAILED" });
  if (rawCode === "MODERATION_BLOCKED") return new ModerationError(message, { ...init, code: rawCode });
  return new InvalidRequestError(message, { ...init, code: rawCode ?? "INVALID_REQUEST" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readEnv(name: string): string | undefined {
  try {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> }; Deno?: { env?: { get(n: string): string | undefined } } };
    return g.process?.env?.[name] ?? g.Deno?.env?.get(name);
  } catch {
    return undefined;
  }
}

function isBrowser(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window !== "undefined" && typeof g.document !== "undefined";
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, (date - Date.now()) / 1000);
}

function backoffMs(attempt: number): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("The operation was aborted");
}

function toVideo(raw: any): Video {
  return {
    id: raw.id,
    status: raw.status,
    videoUrl: raw.video_url ?? null,
    prompt: raw.prompt,
    enhancedPrompt: raw.enhanced_prompt,
    resolution: raw.resolution,
    duration: raw.duration,
    orientation: raw.orientation,
    firstFrame: Boolean(raw.first_frame),
    lastFrame: Boolean(raw.last_frame),
    costUsd: raw.cost_usd,
    refunded: Boolean(raw.refunded),
    generationTimeMs: raw.generation_time_ms ?? null,
    error: raw.error ?? null,
    createdAt: raw.created_at,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AnimeAPI {
  readonly baseURL: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;
  readonly images: Images;
  readonly videos: Videos;
  readonly models: Models;

  readonly #apiKey: string;
  readonly #fetch: FetchLike;

  constructor(options: AnimeAPIOptions | string = {}) {
    const opts = typeof options === "string" ? { apiKey: options } : options;
    const apiKey = opts.apiKey ?? readEnv("ANIMEAPI_API_KEY");
    if (!apiKey) {
      throw new AuthenticationError(
        "Missing API key. Pass { apiKey } or set ANIMEAPI_API_KEY. Create a key at https://animeapi.ai/dashboard/api-keys",
        { status: 0, code: "INVALID_KEY", retryable: false },
      );
    }
    const fetchImpl = opts.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("No global fetch found. Use Node 18+ or pass { fetch }.");
    }
    this.#apiKey = apiKey;
    // Calling through a wrapper keeps `this` correct for the global fetch in browsers and Workers.
    this.#fetch = opts.fetch ?? ((input, init) => (globalThis as unknown as { fetch: FetchLike }).fetch(input, init));
    this.baseURL = (opts.baseURL ?? readEnv("ANIMEAPI_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.images = new Images(this);
    this.videos = new Videos(this);
    this.models = new Models(this);
  }

  /** Shortcut for `client.images.generate(...)`. */
  generate(params: GenerateImageParams | string, options?: RequestOptions): Promise<GeneratedImage> {
    return this.images.generate(params, options);
  }

  /**
   * Low-level request with authentication, timeout and retries. Returns the parsed JSON body.
   * `path` is relative to the base URL, for example `/api/generate`.
   */
  async request<T = unknown>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const url = this.baseURL + path;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // Browsers only allow the two headers above across origins.
    if (!isBrowser()) headers["User-Agent"] = `animeapi-js/${VERSION}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);

    const response = await this.#send(url, { method, headers, body: payload }, options);
    const text = await response.text();
    try {
      return (text ? JSON.parse(text) : {}) as T;
    } catch {
      throw new GenerationError("AnimeAPI returned a response that was not JSON.", {
        status: response.status,
        code: "GENERATION_FAILED",
        retryable: false,
        body: text,
      });
    }
  }

  /** Download a file (for example an image or video URL returned by the API) as bytes. */
  async download(url: string, options: RequestOptions = {}): Promise<DownloadedFile> {
    const response = await this.#send(url, { method: "GET" }, options, /* authenticated */ false);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }

  async #send(url: string, init: RequestInit, options: RequestOptions, authenticated = true): Promise<Response> {
    const maxRetries = Math.max(0, options.maxRetries ?? this.maxRetries);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    for (let attempt = 0; ; attempt++) {
      let error: AnimeAPIError;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onAbort = () => controller.abort();
      if (options.signal?.aborted) {
        clearTimeout(timer);
        throw abortReason(options.signal);
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const response = await this.#fetch(url, { ...init, signal: controller.signal });
        if (response.ok) return response;
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const text = await response.text().catch(() => "");
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : undefined;
        } catch {
          /* keep the text */
        }
        error = authenticated
          ? errorFromResponse(response.status, parsed, retryAfter)
          : new AnimeAPIError(`Download failed with status ${response.status}`, {
              status: response.status,
              code: response.status === 404 ? "NOT_FOUND" : "GENERATION_FAILED",
              retryable: response.status >= 500,
              retryAfter,
              body: parsed,
            });
      } catch (cause) {
        if (options.signal?.aborted) throw abortReason(options.signal);
        if (cause instanceof AnimeAPIError) throw cause;
        error = timedOut
          ? new TimeoutError(`Request timed out after ${timeoutMs} ms`, { status: 0, code: "TIMEOUT", retryable: false, cause })
          : new ConnectionError(`Could not reach AnimeAPI: ${(cause as Error)?.message ?? String(cause)}`, {
              status: 0,
              code: "CONNECTION_ERROR",
              retryable: true,
              cause,
            });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }

      if (!error.retryable || attempt >= maxRetries) throw error;
      const wait =
        error.retryAfter !== undefined ? Math.min(MAX_RETRY_AFTER_MS, error.retryAfter * 1000) : backoffMs(attempt);
      await sleep(wait, options.signal);
    }
  }
}

export class Images {
  readonly #client: AnimeAPI;
  constructor(client: AnimeAPI) {
    this.#client = client;
  }

  /**
   * Generate one anime image. Synchronous: resolves in about 4 seconds on `anime`,
   * about 11 seconds on `ultra`. Pass a string for the defaults.
   */
  async generate(params: GenerateImageParams | string, options?: RequestOptions): Promise<GeneratedImage> {
    const p = typeof params === "string" ? { prompt: params } : params;
    const body: Record<string, unknown> = { prompt: p.prompt };
    if (p.model !== undefined) body.model = p.model;
    if (p.orientation !== undefined) body.orientation = p.orientation;
    if (p.enhance !== undefined) body.enhance = p.enhance;
    const raw = await this.#client.request<any>("POST", "/api/generate", body, options);
    return {
      imageUrl: raw.image_url,
      enhancedPrompt: raw.enhanced_prompt,
      balanceUsd: raw.balance_usd,
      generationTimeMs: raw.generation_time_ms,
    };
  }

  /** Download the image bytes. Image URLs are not permanent storage, so save what you want to keep. */
  download(image: GeneratedImage | string, options?: RequestOptions): Promise<DownloadedFile> {
    return this.#client.download(typeof image === "string" ? image : image.imageUrl, options);
  }
}

export class Videos {
  readonly #client: AnimeAPI;
  constructor(client: AnimeAPI) {
    this.#client = client;
  }

  /**
   * Start a video job. Returns at once with a job id; the price is charged up front
   * (480p $0.016 per second, 768p $0.04 per second) and refunded if the job fails.
   */
  async create(params: CreateVideoParams, options?: RequestOptions): Promise<VideoJob> {
    const body: Record<string, unknown> = { prompt: params.prompt };
    if (params.resolution !== undefined) body.resolution = params.resolution;
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.orientation !== undefined) body.orientation = params.orientation;
    if (params.enhance !== undefined) body.enhance = params.enhance;
    if (params.firstFrame !== undefined) body.first_frame = params.firstFrame;
    if (params.lastFrame !== undefined) body.last_frame = params.lastFrame;
    const raw = await this.#client.request<any>("POST", "/api/videos", body, options);
    return {
      id: raw.id,
      status: raw.status,
      pollUrl: raw.poll_url,
      enhancedPrompt: raw.enhanced_prompt,
      resolution: raw.resolution,
      duration: raw.duration,
      orientation: raw.orientation,
      costUsd: raw.cost_usd,
      balanceUsd: raw.balance_usd,
    };
  }

  /** Get a video job by id. */
  async get(id: string, options?: RequestOptions): Promise<Video> {
    const raw = await this.#client.request<any>("GET", `/api/videos/${encodeURIComponent(id)}`, undefined, options);
    return toVideo(raw);
  }

  /**
   * Poll until the video has finished. Resolves with the finished video, throws
   * `VideoFailedError` if the job failed and `TimeoutError` if it took too long.
   */
  async wait(job: string | { id: string }, options: WaitOptions = {}): Promise<Video> {
    const id = typeof job === "string" ? job : job.id;
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 600_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const video = await this.get(id, { signal: options.signal });
      options.onPoll?.(video);
      if (video.status === "succeeded") return video;
      if (video.status === "failed") throw new VideoFailedError(video);
      if (Date.now() + intervalMs > deadline) {
        throw new TimeoutError(`Video ${id} was still processing after ${timeoutMs} ms`, {
          status: 0,
          code: "TIMEOUT",
          retryable: false,
        });
      }
      await sleep(intervalMs, options.signal);
    }
  }

  /** Start a video and wait for it to finish. */
  async createAndWait(params: CreateVideoParams, options: WaitOptions = {}): Promise<Video> {
    const job = await this.create(params, { signal: options.signal });
    return this.wait(job.id, options);
  }

  /** Download the finished MP4 as bytes. */
  download(video: Video | string, options?: RequestOptions): Promise<DownloadedFile> {
    const url = typeof video === "string" ? video : video.videoUrl;
    if (!url) {
      throw new InvalidRequestError("This video has no URL yet. Wait until its status is succeeded.", {
        status: 0,
        code: "INVALID_REQUEST",
        retryable: false,
      });
    }
    return this.#client.download(url, options);
  }
}

export class Models {
  readonly #client: AnimeAPI;
  constructor(client: AnimeAPI) {
    this.#client = client;
  }

  /** List the available image models with their prices. */
  async list(options?: RequestOptions): Promise<Model[]> {
    const raw = await this.#client.request<{ data?: any[] }>("GET", "/v1/models", undefined, options);
    return (raw.data ?? []).map((m) => ({
      id: m.id,
      object: "model",
      created: m.created,
      ownedBy: m.owned_by,
      description: m.description,
    }));
  }
}

export default AnimeAPI;
