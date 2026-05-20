vault {
  address = "http://vault:8200"
}

# top-level: กำหนด delimiter สำหรับ template ทุก block
template_config {
  left_delimiter  = "{{"
  right_delimiter = "}}"
}

auto_auth {
  method "approle" {
    config = {
      role_id_file_path                = "/tmp/vault-auth/role_id"
      secret_id_file_path              = "/tmp/vault-auth/secret_id"
      remove_secret_id_file_after_reading = true
    }
  }

  # เก็บ token ลง file สำหรับ process อื่นใน container ที่ต้องการ
  sink "file" {
    config = {
      path = "/vault/secrets/.vault-token"
      mode = "0600"
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

# Static secrets — render ใหม่อัตโนมัติก่อน lease หมดอายุ
template {
  source      = "/vault/templates/app.env.tpl"
  destination = "/vault/secrets/app.env"
  perms       = "0644"
}
