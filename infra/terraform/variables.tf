variable "gcp_project_id" {
  type        = string
  description = "GCP project ID"
}

variable "gcp_region" {
  type    = string
  default = "us-central1"
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_zone_id" {
  type = string
}

variable "api_image" {
  type        = string
  description = "Fully qualified container image for the API, e.g. gcr.io/PROJECT/peoplefinder-api:TAG"
}

variable "web_image" {
  type        = string
  description = "Fully qualified container image for the web frontend"
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "db_tier" {
  type    = string
  default = "db-f1-micro"
}
