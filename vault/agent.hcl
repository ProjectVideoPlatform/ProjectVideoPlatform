vault {
  address = "http://vault:8200"
}

auto_auth {
  method "approle" {
    config = {
      role_id_file_path   = "/app/keys/role_id"
      role_id_file_path   = "/tmp/vault-auth/role_id"    # ← tmpfs
      secret_id_file_path = "/tmp/vault-auth/secret_id"  # ← tmpfs
              remove_secret_id_file_after_reading = true
    }
  }
  sink "file" {
    config = {
      path = "/vault/secrets/.vault-token"
    }
  }
}

cache {
  use_auto_auth_token = true
}

listener "tcp" {
  address     = "0.0.0.0:8007"
  tls_disable = true
}

# Static secrets
template {
  source      = "/vault/templates/app.env.tpl"
  destination = "/vault/secrets/app.env"
  perms       = "0644"
  # render ใหม่อัตโนมัติก่อน credentials หมดอายุ
  left_delimiter  = "{{"
  right_delimiter = "}}"
}