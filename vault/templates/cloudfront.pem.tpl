{{ with secret "secret/data/cloudfront/keys" }}
{{ .Data.data.CLOUDFRONT_PRIVATE_KEY }}
{{ end }}