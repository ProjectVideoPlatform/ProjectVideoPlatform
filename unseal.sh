#!/bin/bash
VAULT_ADDR="http://127.0.0.1:8200"

UNSEAL_KEYS=(
  "nwXfgGscg+OlBqIGJzcgI6+6uOU5uUIcfDCl2Xdn7Mhc"
  "BYNe+2mvvokcKakZSn0KFuCtYzF1ilGPjOv6pGfY/3CB"
  "LMe+Mkra6fVYJKp2w83iMHeBdl/PiNc6+//gJg1osNGa"
)
ttpho@kuy:/mnt/c/Github/ProjectVideoPlatform/vault/init$ docker exec -e VAULT_ADDR="http://127.0.0.1:8200" vault vault operator init
Unseal Key 1: nwXfgGscg+OlBqIGJzcgI6+6uOU5uUIcfDCl2Xdn7Mhc
Unseal Key 2: BYNe+2mvvokcKakZSn0KFuCtYzF1ilGPjOv6pGfY/3CB
Unseal Key 3: LMe+Mkra6fVYJKp2w83iMHeBdl/PiNc6+//gJg1osNGa
Unseal Key 4: oecx+tTWNkd2XzBBTeeB5nKZJl4jdzBk4TOIuIt4U6lK
Unseal Key 5: yhHbzPbopEDAy37by4LznyE0jtaXpnDOAgKhkUzM15Fh

Initial Root Token: hvs.5MOc9hr7fNAfvAOswx5uj9E8
for key in "${UNSEAL_KEYS[@]}"; do
  docker exec -e VAULT_ADDR="$VAULT_ADDR" vault vault operator unseal "$key"
done

echo "Done"