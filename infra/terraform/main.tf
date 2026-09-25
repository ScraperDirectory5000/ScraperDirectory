terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# --- Cloud Run services (deployed via CI once images are built) ---

resource "google_cloud_run_v2_service" "api" {
  name     = "unnamedfiles-api"
  location = var.gcp_region

  template {
    containers {
      image = var.api_image
      env {
        name  = "DATABASE_URL"
        value = var.database_url
      }
    }
  }
}

resource "google_cloud_run_v2_service" "web" {
  name     = "unnamedfiles-web"
  location = var.gcp_region

  template {
    containers {
      image = var.web_image
    }
  }
}

# --- Cloud SQL (Postgres) ---

resource "google_sql_database_instance" "main" {
  name             = "unnamedfiles-db"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  settings {
    tier = var.db_tier
  }

  deletion_protection = true
}

# --- Cloudflare DNS + proxy in front of Cloud Run ---

resource "cloudflare_record" "web" {
  zone_id = var.cloudflare_zone_id
  name    = "@"
  type    = "CNAME"
  content = google_cloud_run_v2_service.web.uri
  proxied = true
}

resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "CNAME"
  content = google_cloud_run_v2_service.api.uri
  proxied = true
}
