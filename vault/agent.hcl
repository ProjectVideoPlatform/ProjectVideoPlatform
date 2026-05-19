vault {
  address = "http://vault:8200"
}

# Auth Method — AppRole (เหมาะกับ container)
auto_auth {
  method "approle" {
    config = {
      role_id_file_path   = "/app/keys/role_id"
      secret_id_file_path = "/app/keys/secret_id"
    }
  }

  sink "file" {
    config = {
      path = "/vault/secrets/.vault-token"
    }
  }
}

# Render template → เป็นไฟล์ .env ให้ app อ่าน
template {
  source      = "/vault/templates/app.env.tpl"
  destination = "/vault/secrets/app.env"
  perms       = "0640"
}

# Cache token ใน memory
cache {
  use_auto_auth_token = true
}

# Listener สำหรับ app อื่น proxy ผ่าน agent
listener "tcp" {
  address     = "0.0.0.0:8007"
  tls_disable = true
}