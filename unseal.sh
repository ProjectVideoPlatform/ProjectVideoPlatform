#!/bin/bash
VAULT_ADDR="http://127.0.0.1:8200"
#initก่อน
# docker exec -it vault vault operator init -address=http://127.0.0.1:8200
UNSEAL_KEYS=(
  "3fuUjKNK4CEc9bvspyPJjQwT/i/IXatyGC5XE3JGmT9d"
  "Ia92gj7IK4vTefOaErMPmxb+S+E3Dt70G4inm7z/ydZ+"
  "kKid9+IREO+flR9LY1fRiVxlxELCxJUQdxpWcys5Ng2w"
)
# ttpho@kuy:/mnt/c/Github/ProjectVideoPlatform/vault/init$ docker exec -it vault vault operator init -address=http://127.0.0.1:8200
# Unseal Key 1: 3fuUjKNK4CEc9bvspyPJjQwT/i/IXatyGC5XE3JGmT9d
# Unseal Key 2: Ia92gj7IK4vTefOaErMPmxb+S+E3Dt70G4inm7z/ydZ+
# Unseal Key 3: kKid9+IREO+flR9LY1fRiVxlxELCxJUQdxpWcys5Ng2w
# Unseal Key 4: gJ0PtKCwmvVOSmvWXk8W8EjbL99uwPEgOkKNz9C8I9wn
# Unseal Key 5: 18KWqRLYRcz/x6Odg9b/tgLTf9O9+M+A3Tz3ehxziJax

Initial Root Token: hvs.CXFJucJFilt8UGWcTdohtBUA

for key in "${UNSEAL_KEYS[@]}"; do
  docker exec -e VAULT_ADDR="$VAULT_ADDR" vault vault operator unseal "$key"
done

echo "Done"