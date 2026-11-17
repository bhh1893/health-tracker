variable "signup_brake_edge" {
  description = "Block /oauth2/start at Cloudflare: level 2 of the Sign-up brake (ADR 0026). Also stops existing Users signing in again."
  type        = bool
  default     = false
}
