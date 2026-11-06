#!/bin/sh
# Installed with the .deb/.rpm. Joining and the service are explicit steps so a package install
# never starts work on a machine by itself.
cat <<'EOF'
Foundry runner installed. Next:
  foundry runner join <token> --server https://<your-foundry>
  foundry runner install-service            # per-user service, starts on login
  sudo foundry runner install-service --system --user foundry   # shared box, starts on boot
EOF
