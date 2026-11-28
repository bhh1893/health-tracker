# Portable object storage: S3 API across Garage, AWS, Azure and others

Research for [#293](https://github.com/bhh1893/health-tracker/issues/293), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Feeds [#296 Where Meal Photo bytes live](https://github.com/bhh1893/health-tracker/issues/296) and [#297 Upload and download path](https://github.com/bhh1893/health-tracker/issues/297). Facts only; the decision belongs to those tickets.

Checked 2026-11-27. Garage facts are read from the source at tag `v2.5.0`, the version pinned in `iac/ansible/roles/garage/defaults/main.yml`. Line numbers below refer to that tag.

## Summary

- **S3 API natively:** Garage, AWS S3, Cloudflare R2, and Google Cloud Storage (through its XML API with HMAC keys). **Azure Blob Storage does not** speak S3; it needs a gateway such as S3Proxy, which drops several features.
- **Generic clients:** boto3 calls itself "the AWS SDK for Python"; minio-py calls itself the "MinIO Python SDK for Amazon S3 Compatible Cloud Storage" and has had no PyPI release for a year; obstore is a multi-cloud client with native S3, GCS and Azure backends. Whether any of them is a "provider SDK" is a definition the repo has not written down yet.
- **Garage v2.5.0 supports:** presigned GET/PUT (max 7 days), POST policy uploads with `content-length-range` enforced while the body streams, per-bucket CORS, per-key per-bucket read/write/owner grants, bucket quotas (max size, max objects), and lifecycle rules limited to `Expiration` and `AbortIncompleteMultipartUpload`. It has **no** at-rest encryption except SSE-C, no bucket policies, no ACLs.
- **Encryption at rest:** always on and not disableable on AWS (SSE-S3 since 2023-01-05), Azure, GCS and R2. Garage has none unless the client sends SSE-C keys. AWS disables SSE-C by default on new buckets since April 2026, so SSE-C is not a portable choice.
- **Content type:** every target stores `Content-Type` sent on upload and returns it on GET. With a presigned PUT, signing the `Content-Type` header makes a mismatched upload fail with a signature error (documented by R2; this is how SigV4 signed headers work).

## 1. Which targets speak the S3 API

| Target | S3 API | How | Source |
| --- | --- | --- | --- |
| Garage | Native | S3 endpoint, SigV4 auth, "per-access-key-per-bucket" permissions | [Garage S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/) |
| AWS S3 | Native | The reference implementation | [AWS S3 user guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) |
| Cloudflare R2 | Native, partial | Per-operation compatibility table | [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) |
| Google Cloud Storage | Native via XML API | Point the client at the XML API endpoint, use HMAC keys, keep `AWS4-HMAC-SHA256`; "Cloud Storage processes `x-amz-*` headers that have an `x-goog-*` equivalent" | [GCS interoperability](https://docs.cloud.google.com/storage/docs/interoperability), [Simple migration from S3](https://docs.cloud.google.com/storage/docs/aws-simple-migration) |
| Azure Blob Storage | **No** | Authorization is Shared Key, SAS, Microsoft Entra ID or anonymous read; SigV4 is not among them | [Authorize requests to Azure Storage](https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-requests-to-azure-storage) |

**Azure through a gateway.** [S3Proxy](https://github.com/gaul/s3proxy) (Apache-2.0, release 4.2.0 on 2026-11-18) has an `azureblob` backend. Its README lists what it does not carry over: bucket CORS operations ("S3Proxy only supports a static configuration"), bucket policies, lifecycle, and on Azure only SSE-S3 ("AES256 relayed from Azure's own at-rest encryption"; SSE-C and SSE-KMS refused). The gateway is one more service to run and patch. Commercial gateways exist in Azure Marketplace (for example Flexify.IO); not evaluated.

**Azure natively.** The Blob REST API has its own equivalents: a SAS is the presigned URL, `Content-Type` (or `x-ms-blob-content-type`) sets the blob's type, Put Blob accepts up to 5,000 MiB in one write (service version 2019-12-12 and later) ([Put Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob)). Reaching Azure without a gateway means a second client code path (or a library with an Azure backend, see obstore below).

## 2. Generic S3 clients and the "no provider SDK" rule

`CLAUDE.md` says "no provider SDKs in service code" but does not define the term, and no ADR does either. Facts that bear on it:

| Library | What it calls itself | Backends | Maintenance (2026-11-27) | Source |
| --- | --- | --- | --- | --- |
| boto3 | "The AWS SDK for Python (Boto3)" | AWS services; any S3 endpoint via `endpoint_url` | 1.44.13 released 2026-11-27; repo active; Apache-2.0 | [PyPI](https://pypi.org/project/boto3/), [GitHub](https://github.com/boto/boto3) |
| aiobotocore | "Async client for aws services using botocore and aiohttp" | Same as boto3, async | 3.10.0 on 2026-10-23; Apache-2.0 | [PyPI](https://pypi.org/project/aiobotocore/) |
| minio-py | "MinIO Python SDK for Amazon S3 Compatible Cloud Storage" | Any S3 endpoint | Last PyPI release 7.2.20 on 2025-11-27; commits as late as 2026-09-29; the MinIO server repo is archived | [PyPI](https://pypi.org/project/minio/), [GitHub](https://github.com/minio/minio-py), [minio/minio](https://github.com/minio/minio) |
| obstore | "Python interface to Amazon S3, Google Cloud Storage, Azure Storage, & other S3-compliant APIs"; "no required Python dependencies" | S3, GCS, Azure, HTTP, local, memory; `sign()` for S3, GCS and Azure stores | py-v0.12.1 on 2026-10-27; MIT; built on Apache `object_store` (Rust, v0.14.2) | [obstore docs](https://developmentseed.org/obstore/latest/), [sign API](https://developmentseed.org/obstore/latest/api/sign/), [GitHub](https://github.com/developmentseed/obstore) |

Things to weigh, not a verdict:

- boto3 speaks only the S3 wire protocol to non-AWS targets; nothing AWS-specific is required if the endpoint, region and keys come from env vars. The repo already depends on it indirectly: ADR 0011 tested Barman with boto3 1.43.124 against Garage.
- obstore is the only listed library that reaches Azure without a gateway, by switching backend from config. Its `sign()` page does not document setting `Content-Type` or other signed headers, and it does not cover POST policies.
- **boto3 checksum default.** AWS SDKs now send a CRC checksum on every upload by default (`request_checksum_calculation = WHEN_SUPPORTED`, env var `AWS_REQUEST_CHECKSUM_CALCULATION`; boto3 default CRC32) ([AWS SDK data integrity](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)). Non-AWS targets support checksums unevenly: R2 lists CRC32/CRC32C/SHA1/SHA256 as COMPOSITE only and some operations reject checksum headers ([R2](https://developers.cloudflare.com/r2/api/s3/api/)). `WHEN_REQUIRED` is the env-var switch if a target rejects them.

## 3. What Garage v2.5.0 supports

| Feature | Status | Detail | Source |
| --- | --- | --- | --- |
| Presigned URLs | Yes | Any method; `X-Amz-Expires` over a week is rejected ("may not exceed a week"); always `UNSIGNED-PAYLOAD` | `src/api/common/signature/payload.rs:142-215, 543-551` |
| POST policy (browser form upload) | Yes | Conditions `eq`, `starts-with`, `content-length-range`; expiration checked; form fields not named in the policy are rejected; `content-length-range` enforced while streaming, failing early once the body passes the max | `src/api/s3/post_object.rs:135-228, 348-470` |
| CORS | Yes | `Get/Put/DeleteBucketCors`; the S3 endpoint answers `OPTIONS` preflights from the bucket's rules | [compat page](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/), `src/api/s3/api_server.rs:121-162` |
| Bucket-scoped keys | Yes | `garage bucket allow/deny` grants read, write, owner per key per bucket; key can be barred from `CreateBucket`. Already used for `cnpg-backup` (ADR 0011) | `src/garage/cli/structs.rs:287-293, 379-387, 556` |
| Quotas | Yes | `garage bucket set-quotas --max-size --max-objects`; PUT fails once exceeded | `structs.rs:397-408`, `src/api/s3/put.rs:346-390` |
| Object size limit | None found | No per-object cap in `put.rs` or `multipart.rs`; size is bounded by quotas, POST `content-length-range`, or whatever sits in front | `put.rs`, `multipart.rs` |
| Lifecycle | Partial | Only `Expiration` and `AbortIncompleteMultipartUpload`; prefix must be inside `Filter` | [compat page](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/) |
| Server-side encryption | SSE-C only | "we did not implement server-side encryption"; `Get/Put/DeleteBucketEncryption` missing; SSE-C (AES-256-GCM with client key) implemented | compat page, `src/api/s3/encryption.rs:37-51` |
| ACLs, bucket policies | No | Missing; `GetBucketAcl` partial | compat page |
| Content-Type | Stored | `Content-Type`, `Cache-Control`, `Content-Disposition`, `Content-Encoding`, `Content-Language`, `Expires` and `x-amz-meta-*` kept from the upload; GET honours `response-content-type` and the other `response-*` overrides | `put.rs:672-705`, `src/api/s3/get.rs:42-45, 134-137` |
| Conditional PUT (`If-None-Match`) | Not found | No handling in `put.rs` (GET supports `If-None-Match`) | `put.rs`, `get.rs:13` |

Repo context: Garage today listens on `192.168.56.20:3900`, plain HTTP, host-only network (ADR 0011). A presigned URL is only usable by a client that can reach that address, so a browser-direct path would need Garage exposed through the edge (ADRs 0021, 0025), while a proxy-through-`api` path would not.

## 4. Feature matrix across targets

| | Garage 2.5.0 | AWS S3 | Cloudflare R2 | GCS (XML API) | Azure Blob |
| --- | --- | --- | --- | --- | --- |
| Presigned GET/PUT | Yes, max 7 days | Yes, max 7 days with IAM user keys; shorter with temporary credentials ([AWS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)) | GET, HEAD, PUT, DELETE; max 7 days; S3 API domain only, not custom domains ([R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)) | V4 signing with HMAC supported ([GCS](https://docs.cloud.google.com/storage/docs/interoperability)) | SAS, not SigV4 |
| POST policy | Yes | Yes | **No**: "POST (multipart form uploads via HTML forms) is not currently supported" ([R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)) | Yes, but documented only with `GOOG4-HMAC-SHA256` and `x-goog-*` form fields ([GCS](https://docs.cloud.google.com/storage/docs/xml-api/post-object-forms)) | No equivalent |
| Enforce Content-Type on presigned PUT | Signed header | Signed header | Signed header; mismatch gives 403 `SignatureDoesNotMatch` ([R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)) | Signed header | SAS has its own rules |
| CORS via S3 API | Yes | Yes | Yes ([R2](https://developers.cloudflare.com/r2/api/s3/api/)) | Not verified | Native Azure CORS; static only via S3Proxy |
| Lifecycle via S3 API | Expiration, abort MPU | Full | Yes | Not verified | Not via S3Proxy |
| Multipart upload | Yes | Yes | Yes | "compatible with Amazon S3 multipart uploads" ([GCS](https://docs.cloud.google.com/storage/docs/multipart-uploads)) | Put Block / Put Block List |
| Encryption at rest | **None** unless SSE-C | Always, SSE-S3 default since 2023-01-05 ([AWS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html)) | Always, AES-256-GCM ([R2](https://developers.cloudflare.com/r2/reference/data-security/)) | Always ([GCS](https://docs.cloud.google.com/storage/docs/encryption/default-keys)) | Always, "You can't disable Azure Storage encryption" ([Azure](https://learn.microsoft.com/en-us/azure/storage/common/storage-service-encryption)) |
| SSE-C | Yes | Disabled by default on new buckets since April 2026; 403 unless re-enabled ([AWS FAQ](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-s3-c-encryption-setting-faq.html), [What's New](https://aws.amazon.com/about-aws/whats-new/2026/04/s3-default-bucket-security-setting)) | Yes; `x-amz-server-side-encryption` not implemented ([R2](https://developers.cloudflare.com/r2/api/s3/api/)) | Own `x-goog-encryption-*` headers; S3 mapping not verified | Own `x-ms-encryption-key` headers ([Put Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob)); refused via S3Proxy |
| Per-object Content-Type | Stored | Stored | Stored | Stored | Stored (`Content-Type` or `x-ms-blob-content-type`) |
| Conditional PUT `If-None-Match` | Not found | Yes | Yes, atomic ([R2](https://developers.cloudflare.com/r2/api/s3/api/)) | Not verified | Conditional headers supported ([Put Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob)) |

## 5. Implications for #296 and #297

- **The portable subset** across Garage, AWS, R2 and GCS: PutObject, GetObject, DeleteObject, presigned GET and PUT with a signed `Content-Type`, endpoint and keys from env vars. Azure falls outside it without a gateway or a multi-backend library.
- **POST policy is not portable.** It is the only S3 mechanism that lets the store cap upload size on a browser-direct upload, and R2 lacks it while GCS documents it only in its own signing format. A presigned PUT cannot cap size by itself; the size has to be checked elsewhere (by `api` before signing plus after upload, or by proxying).
- **At-rest encryption differs.** Every cloud target encrypts by default; Garage on the dev VM does not. SSE-C would close that on Garage but breaks on AWS by default, and the service would have to hold the key.
- **Garage quotas** are a store-side backstop against "fill the disk", independent of the upload path. No portable equivalent across clouds was checked.
- **Lifecycle** for orphan cleanup must stick to `Expiration` and `AbortIncompleteMultipartUpload` to work on Garage.

## Not verified

- GCS CORS and lifecycle through the S3-compatible XML API, and whether GCS maps `x-amz-server-side-encryption-customer-*` to its own CSEK headers.
- Garage behaviour with boto3 1.44's default checksums on PutObject (ADR 0011 tested 1.43.124 with Barman only).
- A presigned PUT against Garage from a browser end to end, including CORS preflight. Worth a throwaway test before #297 locks.
