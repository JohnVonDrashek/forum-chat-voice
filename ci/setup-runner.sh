#!/usr/bin/env bash
# Setup script for a self-hosted GitHub Actions runner on Ubuntu/Debian.
# Run this on a fresh LXC or VM that has network access to all service LXCs.
#
# Usage: sudo bash ci/setup-runner.sh
#
# After this script completes:
#   1. Copy your deploy SSH key to /home/runner/.ssh/id_deploy
#   2. Register the runner: cd /home/runner/actions-runner && ./config.sh --url https://github.com/forumline/forumline --token <TOKEN>
#   3. Install as service: sudo ./svc.sh install runner && sudo ./svc.sh start

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

echo "=== Installing system packages ==="
apt-get update
apt-get install -y curl git build-essential jq unzip openssh-client

echo "=== Installing Go 1.26 ==="
curl -fsSL "https://go.dev/dl/go1.26.0.linux-amd64.tar.gz" -o /tmp/go.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf /tmp/go.tar.gz
rm /tmp/go.tar.gz

echo "=== Installing Node.js 22 ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "=== Installing pnpm ==="
corepack enable
corepack prepare pnpm@10.6.5 --activate

echo "=== Installing golangci-lint ==="
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b /usr/local/bin v2.11.2

echo "=== Installing gitleaks ==="
curl -fsSL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz -C /usr/local/bin gitleaks

echo "=== Installing sops + age ==="
curl -fsSL "https://dl.filippo.io/age/v1.2.0?for=linux/amd64" -o /tmp/age.tar.gz
tar -xzf /tmp/age.tar.gz -C /tmp && mv /tmp/age/age /usr/local/bin/ && rm -rf /tmp/age*
curl -fsSL "https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.amd64" -o /usr/local/bin/sops
chmod +x /usr/local/bin/sops

echo "=== Creating runner user ==="
id runner &>/dev/null || useradd -m -s /bin/bash runner

echo "=== Setting up PATH for runner ==="
cat > /home/runner/.profile_extras <<'EOF'
export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"
EOF
grep -q profile_extras /home/runner/.bashrc 2>/dev/null || echo 'source ~/.profile_extras' >> /home/runner/.bashrc
# Also set PATH in environment file for the service
mkdir -p /home/runner/actions-runner
cat > /home/runner/actions-runner/.env <<'EOF'
PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin:/home/runner/go/bin
EOF

echo "=== Setting up SSH for LAN access ==="
mkdir -p /home/runner/.ssh
chmod 700 /home/runner/.ssh
cat > /home/runner/.ssh/config <<'SSHEOF'
Host forumline-prod
  HostName 192.168.1.99
  User root
  IdentityFile ~/.ssh/id_deploy
  StrictHostKeyChecking no

Host hosted-prod
  HostName 192.168.1.107
  User root
  IdentityFile ~/.ssh/id_deploy
  StrictHostKeyChecking no

Host website-prod
  HostName 192.168.1.106
  User root
  IdentityFile ~/.ssh/id_deploy
  StrictHostKeyChecking no

Host logs-prod
  HostName 192.168.1.108
  User root
  IdentityFile ~/.ssh/id_deploy
  StrictHostKeyChecking no

Host forum-prod
  HostName 192.168.1.23
  User root
  IdentityFile ~/.ssh/id_deploy
  StrictHostKeyChecking no
SSHEOF
chmod 600 /home/runner/.ssh/config
chown -R runner:runner /home/runner/.ssh

echo "=== Downloading GitHub Actions runner ==="
RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
cd /home/runner/actions-runner
curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" -o runner.tar.gz
tar xzf runner.tar.gz
rm runner.tar.gz
chown -R runner:runner /home/runner/actions-runner

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy your deploy SSH key:"
echo "     scp ~/.ssh/id_deploy root@<this-host>:/home/runner/.ssh/id_deploy"
echo "     chown runner:runner /home/runner/.ssh/id_deploy && chmod 600 /home/runner/.ssh/id_deploy"
echo ""
echo "  2. Get a runner registration token from:"
echo "     https://github.com/forumline/forumline/settings/actions/runners/new"
echo ""
echo "  3. Register the runner (as the runner user):"
echo "     su - runner"
echo "     cd ~/actions-runner"
echo "     ./config.sh --url https://github.com/forumline/forumline --token <TOKEN>"
echo ""
echo "  4. Install and start as a service:"
echo "     sudo ./svc.sh install runner"
echo "     sudo ./svc.sh start"
