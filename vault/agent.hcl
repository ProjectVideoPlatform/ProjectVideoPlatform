vault {
  address = "http://vault:8200"
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"

    config = {
      role_id_file_path               = "/tmp/vault-auth/role_id"
      secret_id_file_path             = "/tmp/vault-auth/secret_id"
      remove_secret_id_file_after_reading = true
    }
  }

  sink "file" {
    config = {
      path = "/vault/secrets/.vault-token"
    }
  }
}

template {
  source      = "/vault/templates/app.env.tpl"
  destination = "/vault/secrets/app.env"
  perms       = "0644"
}

template {
  source      = "/vault/templates/cloudfront.pem.tpl"
  destination = "/vault/secrets/cloudfront-private-key.pem"
  perms       = "0644"
}