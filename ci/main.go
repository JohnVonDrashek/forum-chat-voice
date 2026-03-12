// Forumline CI/CD pipelines — portable via Dagger
//
// All pipelines can be run locally with `dagger call <function> --source .`
// or from any CI provider. GitHub Actions workflows are thin wrappers.
package main

import (
	"context"
	"dagger/forumline/internal/dagger"
	"fmt"
)

type Forumline struct{}

// Lint runs the full CI check suite via lefthook (Go lint, Go tests, ESLint, TS tests, gitleaks)
func (m *Forumline) Lint(ctx context.Context, source *dagger.Directory) (string, error) {
	goModCache := dag.CacheVolume("go-mod")
	goBuildCache := dag.CacheVolume("go-build")
	pnpmStore := dag.CacheVolume("pnpm-store")

	ctr := dag.Container().
		From("golang:1.26").
		// Node.js 22
		WithExec([]string{"bash", "-c", "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"}).
		WithExec([]string{"apt-get", "install", "-y", "nodejs"}).
		// pnpm
		WithExec([]string{"corepack", "enable"}).
		WithExec([]string{"corepack", "prepare", "pnpm@10.6.5", "--activate"}).
		// golangci-lint
		WithExec([]string{"bash", "-c", "curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/HEAD/install.sh | sh -s -- -b /usr/local/bin v2.11.2"}).
		// gitleaks
		WithExec([]string{"bash", "-c", `curl -fsSL https://github.com/gitleaks/gitleaks/releases/download/v8.21.2/gitleaks_8.21.2_linux_x64.tar.gz | tar -xz -C /usr/local/bin gitleaks`}).
		// Caches
		WithMountedCache("/go/pkg/mod", goModCache).
		WithMountedCache("/root/.cache/go-build", goBuildCache).
		WithMountedCache("/root/.local/share/pnpm/store", pnpmStore).
		// Source
		WithMountedDirectory("/src", source).
		WithWorkdir("/src").
		// lefthook needs a git repo to operate
		WithExec([]string{"git", "init"}).
		WithExec([]string{"git", "add", "."}).
		// Install JS deps and run checks
		WithExec([]string{"pnpm", "install", "--frozen-lockfile"}).
		WithExec([]string{"npx", "lefthook", "run", "pre-commit", "--all-files", "--no-tty"})

	return ctr.Stdout(ctx)
}

// Deploy deploys a service to production via SSH through Cloudflare Tunnel.
// Service must be one of: forumline, hosted, website.
func (m *Forumline) Deploy(
	ctx context.Context,
	source *dagger.Directory,
	// Service to deploy (forumline, hosted, or website)
	service string,
	// SSH private key for remote access
	sshKey *dagger.Secret,
	// Cloudflare Access client ID
	cfAccessClientId *dagger.Secret,
	// Cloudflare Access client secret
	cfAccessClientSecret *dagger.Secret,
	// SOPS age key for secret decryption (required for forumline and hosted)
	// +optional
	sopsAgeKey *dagger.Secret,
) (string, error) {
	type serviceConfig struct {
		host      string
		sshHost   string
		remotePath string
		compose   string
		hasEnv    bool
	}

	configs := map[string]serviceConfig{
		"forumline": {"forumline-prod", "app-ssh.forumline.net", "/opt/forumline", "deploy/compose/forumline/docker-compose.yml", true},
		"hosted":    {"hosted-prod", "hosted-ssh.forumline.net", "/opt/hosted", "deploy/compose/hosted/docker-compose.yml", true},
		"website":   {"website-prod", "www-ssh.forumline.net", "/opt/website", "deploy/compose/website/docker-compose.yml", false},
	}

	cfg, ok := configs[service]
	if !ok {
		return "", fmt.Errorf("unknown service: %s (must be forumline, hosted, or website)", service)
	}

	if cfg.hasEnv && sopsAgeKey == nil {
		return "", fmt.Errorf("service %s requires --sops-age-key for secret decryption", service)
	}

	ctr := m.sshContainer(source, sshKey, cfAccessClientId, cfAccessClientSecret)

	// Configure SSH host alias
	ctr = ctr.WithExec([]string{"bash", "-c", fmt.Sprintf(`cat >> /root/.ssh/config <<'SSHEOF'
Host %s
  HostName %s
  User root
  IdentityFile /root/.ssh/id_deploy
  StrictHostKeyChecking no
  ProxyCommand cloudflared access ssh --hostname %%h --id $CF_ACCESS_CLIENT_ID --secret $CF_ACCESS_CLIENT_SECRET
SSHEOF`, cfg.host, cfg.sshHost)})

	// Decrypt and upload env if needed
	if cfg.hasEnv {
		ctr = ctr.
			WithSecretVariable("SOPS_AGE_KEY", sopsAgeKey).
			WithExec([]string{"bash", "-c", fmt.Sprintf(
				`sops -d --input-type dotenv --output-type dotenv deploy/compose/%s/.env.enc > /tmp/service.env`, service)}).
			WithExec([]string{"scp", "/tmp/service.env", fmt.Sprintf("%s:%s/.env", cfg.host, cfg.remotePath)})
	}

	// Upload docker-compose.yml
	ctr = ctr.WithExec([]string{"scp", cfg.compose, fmt.Sprintf("%s:%s/docker-compose.yml", cfg.host, cfg.remotePath)})

	// Pull latest code
	ctr = ctr.WithExec([]string{"ssh", cfg.host, fmt.Sprintf(
		"cd %s/repo && git fetch origin main && git reset --hard origin/main", cfg.remotePath)})

	// Run migrations for forumline
	if service == "forumline" {
		ctr = ctr.WithExec([]string{"ssh", cfg.host, fmt.Sprintf(
			`cd %s && for f in repo/services/forumline-api/migrations/*.sql; do echo "Applying migration: $f" && docker compose exec -T postgres psql -U postgres -d postgres < "$f"; done`,
			cfg.remotePath)})
	}

	// Rebuild and restart
	ctr = ctr.WithExec([]string{"ssh", cfg.host, fmt.Sprintf(
		"cd %s && docker compose up -d --build %s && docker compose ps", cfg.remotePath, service)})

	return ctr.Stdout(ctx)
}

// PublishPackages builds and publishes TypeScript packages to GitHub Packages
func (m *Forumline) PublishPackages(
	ctx context.Context,
	source *dagger.Directory,
	// GitHub token with packages:write scope
	githubToken *dagger.Secret,
) (string, error) {
	pnpmStore := dag.CacheVolume("pnpm-store")

	ctr := dag.Container().
		From("node:20-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "git"}).
		WithExec([]string{"corepack", "enable"}).
		WithExec([]string{"corepack", "prepare", "pnpm@10.6.5", "--activate"}).
		WithMountedCache("/root/.local/share/pnpm/store", pnpmStore).
		WithMountedDirectory("/src", source).
		WithWorkdir("/src").
		WithSecretVariable("NODE_AUTH_TOKEN", githubToken).
		WithSecretVariable("GITHUB_PACKAGES_TOKEN", githubToken).
		WithExec([]string{"pnpm", "install", "--frozen-lockfile"}).
		WithExec([]string{"bash", "-c", `
			for pkg in protocol server-sdk; do
				echo "=== Building and publishing $pkg ==="
				cd "packages/$pkg"
				pnpm run build
				OUTPUT=$(pnpm publish --no-git-checks 2>&1) && echo "$OUTPUT" || {
					if echo "$OUTPUT" | grep -qi "cannot publish over"; then
						echo "Version already published, skipping"
					else
						echo "$OUTPUT"
						exit 1
					fi
				}
				cd ../..
			done
		`})

	return ctr.Stdout(ctx)
}

// TerraformPlan runs an OpenTofu plan and returns the plan output
func (m *Forumline) TerraformPlan(
	ctx context.Context,
	source *dagger.Directory,
	// R2 state backend access key
	r2AccessKeyId *dagger.Secret,
	// R2 state backend secret key
	r2SecretAccessKey *dagger.Secret,
	// Cloudflare API token for provider
	cloudflareApiToken *dagger.Secret,
	// Passphrase for state encryption
	stateEncryptionPassphrase *dagger.Secret,
) (string, error) {
	ctr := dag.Container().
		From("ghcr.io/opentofu/opentofu:1.11.5").
		WithSecretVariable("AWS_ACCESS_KEY_ID", r2AccessKeyId).
		WithSecretVariable("AWS_SECRET_ACCESS_KEY", r2SecretAccessKey).
		WithSecretVariable("TF_VAR_cloudflare_api_token", cloudflareApiToken).
		WithSecretVariable("TF_VAR_state_encryption_passphrase", stateEncryptionPassphrase).
		WithMountedDirectory("/src", source).
		WithWorkdir("/src/deploy/terraform").
		WithExec([]string{"tofu", "init"}).
		WithExec([]string{"tofu", "plan", "-var-file=prod.tfvars", "-no-color"})

	return ctr.Stdout(ctx)
}

// UpdateScreenshots captures forum screenshots with Playwright and uploads to R2
func (m *Forumline) UpdateScreenshots(
	ctx context.Context,
	source *dagger.Directory,
	forumlineApiUrl *dagger.Secret,
	forumlineServiceKey *dagger.Secret,
	r2AccountId *dagger.Secret,
	r2AccessKeyId *dagger.Secret,
	r2SecretAccessKey *dagger.Secret,
	r2BucketName *dagger.Secret,
	r2PublicUrl *dagger.Secret,
) (string, error) {
	ctr := dag.Container().
		From("node:20-slim").
		WithExec([]string{"npx", "playwright", "install", "chromium", "--with-deps"}).
		WithMountedDirectory("/src", source).
		WithWorkdir("/src/.github/scripts").
		WithExec([]string{"npm", "install"}).
		WithSecretVariable("FORUMLINE_API_URL", forumlineApiUrl).
		WithSecretVariable("FORUMLINE_SERVICE_KEY", forumlineServiceKey).
		WithSecretVariable("R2_ACCOUNT_ID", r2AccountId).
		WithSecretVariable("R2_ACCESS_KEY_ID", r2AccessKeyId).
		WithSecretVariable("R2_SECRET_ACCESS_KEY", r2SecretAccessKey).
		WithSecretVariable("R2_BUCKET_NAME", r2BucketName).
		WithSecretVariable("R2_PUBLIC_URL", r2PublicUrl).
		WithExec([]string{"node", "update-forum-screenshots.js"})

	return ctr.Stdout(ctx)
}

// BuildLinux builds the Linux desktop app and returns the tarball
func (m *Forumline) BuildLinux(source *dagger.Directory) *dagger.File {
	ctr := dag.Container().
		From("ubuntu:24.04").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "build-essential", "libgtk-4-dev", "libwebkitgtk-6.0-dev"}).
		WithMountedDirectory("/src", source).
		WithWorkdir("/src/apps/linux").
		WithExec([]string{"make"}).
		WithExec([]string{"bash", "-c", `
			mkdir -p /out/Forumline-linux
			cp forumline /out/Forumline-linux/
			cp net.forumline.app.desktop /out/Forumline-linux/
			cd /out && tar czf Forumline-linux.tar.gz Forumline-linux/
		`})

	return ctr.File("/out/Forumline-linux.tar.gz")
}

// BuildAndroid builds the Android APK and returns it
func (m *Forumline) BuildAndroid(source *dagger.Directory) *dagger.File {
	gradleCache := dag.CacheVolume("gradle")

	ctr := dag.Container().
		From("cimg/android:2024.11-ndk").
		WithMountedCache("/home/circleci/.gradle", gradleCache).
		WithMountedDirectory("/src", source).
		WithWorkdir("/src/apps/android").
		WithExec([]string{"./gradlew", "assembleRelease"}).
		WithExec([]string{"bash", "-c", `
			APK=$(find app/build/outputs/apk -name "*.apk" -type f | head -1)
			cp "$APK" /tmp/Forumline.apk
		`})

	return ctr.File("/tmp/Forumline.apk")
}

// SplitRepos splits the forum subtree and pushes to the read-only repo
func (m *Forumline) SplitRepos(
	ctx context.Context,
	source *dagger.Directory,
	// GitHub token with push access to forumline/forum-server
	splitRepoToken *dagger.Secret,
) (string, error) {
	goCache := dag.CacheVolume("go-mod")

	ctr := dag.Container().
		From("golang:1.26").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "git", "curl"}).
		// Install splitsh-lite
		WithExec([]string{"bash", "-c", `
			curl -fsSL https://github.com/splitsh/lite/releases/download/v1.0.1/lite_linux_amd64.tar.gz -o /tmp/splitsh.tar.gz
			tar -xzf /tmp/splitsh.tar.gz -C /tmp
			mv /tmp/splitsh-lite /usr/local/bin/
		`}).
		WithMountedCache("/go/pkg/mod", goCache).
		WithMountedDirectory("/src", source).
		WithWorkdir("/src").
		WithSecretVariable("SPLIT_REPO_TOKEN", splitRepoToken).
		WithExec([]string{"bash", "-c", `
			# Tag shared-go if changed
			if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q '^packages/shared-go/'; then
				latest=$(git tag -l 'shared-go/v*' --sort=-version:refname | head -1)
				if [ -z "$latest" ]; then
					next="shared-go/v0.1.0"
				else
					version=${latest#shared-go/v}
					major=$(echo "$version" | cut -d. -f1)
					minor=$(echo "$version" | cut -d. -f2)
					patch=$(echo "$version" | cut -d. -f3)
					next="shared-go/v${major}.${minor}.$((patch + 1))"
				fi
				git tag "$next"
				git push origin "$next"
			fi

			# Split the subtree
			SPLIT_SHA=$(splitsh-lite --prefix=services/forum)
			git checkout -b split-result "$SPLIT_SHA"

			# Get latest shared-go version
			SHARED_TAG=$(git tag -l 'shared-go/v*' --sort=-version:refname | head -1)
			if [ -z "$SHARED_TAG" ]; then
				echo "No shared-go tag found — skipping split"
				exit 0
			fi
			SHARED_VERSION=${SHARED_TAG#shared-go/}

			# Rewrite go.mod
			sed -i "s|github.com/forumline/forumline/shared-go v0.0.0-00010101000000-000000000000|github.com/forumline/forumline/shared-go $SHARED_VERSION|" go.mod
			sed -i '/^replace github.com\/forumline\/forumline\/shared-go/d' go.mod
			sed -i -e :a -e '/^\n*$/{$d;N;ba;}' go.mod
			go mod tidy

			# Strip production secrets
			git rm -f deploy/.env.enc deploy/.sops.yaml 2>/dev/null || true

			git config user.name "github-actions[bot]"
			git config user.email "github-actions[bot]@users.noreply.github.com"
			git add go.mod go.sum
			git commit --amend --no-edit

			# Push to read-only repo
			git config --unset-all http.https://github.com/.extraheader || true
			git push "https://x-access-token:${SPLIT_REPO_TOKEN}@github.com/forumline/forum-server.git" HEAD:main --force
		`})

	return ctr.Stdout(ctx)
}

// sshContainer returns a base container with cloudflared + sops + age + SSH configured
func (m *Forumline) sshContainer(
	source *dagger.Directory,
	sshKey *dagger.Secret,
	cfAccessClientId *dagger.Secret,
	cfAccessClientSecret *dagger.Secret,
) *dagger.Container {
	return dag.Container().
		From("debian:bookworm-slim").
		WithExec([]string{"apt-get", "update"}).
		WithExec([]string{"apt-get", "install", "-y", "openssh-client", "curl", "bash"}).
		// cloudflared
		WithExec([]string{"bash", "-c", "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared"}).
		// sops + age
		WithExec([]string{"bash", "-c", `curl -fsSL "https://dl.filippo.io/age/v1.2.0?for=linux/amd64" -o /tmp/age.tar.gz && tar -xzf /tmp/age.tar.gz -C /tmp && mv /tmp/age/age /usr/local/bin/`}).
		WithExec([]string{"bash", "-c", `curl -fsSL "https://github.com/getsops/sops/releases/download/v3.9.4/sops-v3.9.4.linux.amd64" -o /usr/local/bin/sops && chmod +x /usr/local/bin/sops`}).
		// SSH key — write from env var to match original workflow behavior
		// (WithMountedSecret FUSE mount causes "error in libcrypto" with OpenSSH)
		WithExec([]string{"mkdir", "-p", "/root/.ssh"}).
		WithSecretVariable("_SSH_KEY", sshKey).
		WithExec([]string{"bash", "-c", `printf '%s\n' "$_SSH_KEY" > /root/.ssh/id_deploy && chmod 600 /root/.ssh/id_deploy`}).
		// Cloudflare Access credentials
		WithSecretVariable("CF_ACCESS_CLIENT_ID", cfAccessClientId).
		WithSecretVariable("CF_ACCESS_CLIENT_SECRET", cfAccessClientSecret).
		// Source for compose files and encrypted env
		WithMountedDirectory("/src", source).
		WithWorkdir("/src")
}
