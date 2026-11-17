# Bento CLI

Command-line interface for [Bento](https://bentonow.com) email marketing. Manage subscribers, tags, events, and broadcasts directly from your terminal.

[![npm version](https://img.shields.io/npm/v/@bentonow/bento-cli.svg)](https://www.npmjs.com/package/@bentonow/bento-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
# Recommended: Run with npx (always uses latest version)
npx @bentonow/bento-cli --help

# Or install globally
npm install -g @bentonow/bento-cli

# Or with Bun
bun install -g @bentonow/bento-cli
```

> **Tip:** Using `npx` is recommended when possible—it always fetches the latest version, requires no installation, and is ideal for CI/CD pipelines.

## Quick Start

```bash
# 1. Authenticate with your Bento credentials
bento auth login

# 2. Verify your connection
bento stats site

# 3. Start managing your subscribers
bento subscribers search --email user@example.com
bento tags list
```

## Authentication

The CLI uses your Bento API credentials. Get them from [Settings > Teams](https://app.bentonow.com/account/teams) in your Bento dashboard.

```bash
# Interactive login (prompts for credentials)
bento auth login

# Non-interactive login (for CI/scripts)
bento auth login \
  --publishable-key "your-publishable-key" \
  --secret-key "your-secret-key" \
  --site-uuid "your-site-uuid"

# Or run directly with npx (no install required)
npx @bentonow/bento-cli auth login \
  --publishable-key "your-publishable-key" \
  --secret-key "your-secret-key" \
  --site-uuid "your-site-uuid"

# Check authentication status
bento auth status

# Log out (removes stored credentials)
bento auth logout
```

### Multiple Profiles

Manage multiple Bento accounts (e.g., production, staging):

```bash
# Add a named profile
bento profile add production
bento profile add staging

# Switch between profiles
bento profile use staging

# List all profiles
bento profile list

# Remove a profile
bento profile remove staging
```

Credentials are stored securely at:
- **macOS**: `~/Library/Application Support/bento/config.json`
- **Linux**: `~/.config/bento/config.json`
- **Windows**: `%APPDATA%/bento/config.json`

## Commands

### Dashboard

```bash
# Open the Bento dashboard for your active profile
bento dashboard

# Target a specific profile
bento dashboard --profile staging

# JSON mode still opens the browser but prints machine-readable output
bento dashboard --json
```

### Subscribers

```bash
# Look up a subscriber
bento subscribers search --email user@example.com

# Look up + check if they have a tag
bento subscribers search --email user@example.com --tag vip

# Look up + check field value
bento subscribers search --email user@example.com --field plan=pro

# Import subscribers from CSV (email column required)
bento subscribers import contacts.csv
bento subscribers import contacts.csv --dry-run        # Preview first
bento subscribers import contacts.csv --limit 100      # Import first 100

# Add/remove tags from subscribers
bento subscribers tag --email user@example.com --add vip
bento subscribers tag --email user@example.com --remove trial
bento subscribers tag --file users.csv --add customer,active --confirm

# Unsubscribe (stop email delivery)
bento subscribers unsubscribe --email user@example.com
bento subscribers unsubscribe --file unsubscribes.csv --confirm

# Re-subscribe (restore email delivery)
bento subscribers subscribe --email user@example.com

# Engagement summary + recent events
bento subscribers activity user@example.com
bento subscribers activity --uuid 4f1c... --limit 50
```

### Tags

```bash
# List all tags
bento tags list

# Search tags by name
bento tags list news         # Fuzzy match on tag name

# Create a new tag
bento tags create "new-feature-announcement"

# Delete a tag (via web interface - API limitation)
bento tags delete "old-tag"
```

### Custom Fields

```bash
# List all custom fields
bento fields list

# Search fields by key or name
bento fields list company    # Fuzzy match on field key + name

# Create a new field
bento fields create company_size
```

### Events

Track custom events to trigger automations:

```bash
# Track a simple event
bento events track --email user@example.com --event signed_up

# Track with details
bento events track \
  --email user@example.com \
  --event purchase \
  --details '{"product": "Pro Plan", "amount": 99}'
```

### Broadcasts

```bash
# List all broadcasts
bento broadcasts list

# Paginate results
bento broadcasts list --page 1 --per-page 10

# Notes:
# - `--page` by itself uses Bento's API pagination (25 results per page, minimal memory).
# - Adding `--per-page` tells the CLI to fetch the full list once and slice locally, so prefer
#   smaller values here when you have very large broadcast histories.

# Create a broadcast draft
bento broadcasts create \
  --name "January Newsletter" \
  --subject "What's new this month" \
  --content "<h1>Hello!</h1><p>Here's our update...</p>" \
  --type html \
  --include-tags "newsletter,active" \
  --author-id 1 \
  --preview-text "Three things we shipped" \
  --segment-id 12 \
  --send-at 2026-11-20T09:00:00Z

# Show one broadcast (content, audience, schedule, status)
bento broadcasts get 456

# Edit a draft or scheduled broadcast
bento broadcasts update 456 --subject "New subject" --html-file ./emails/jan.html
bento broadcasts update 456 --include-tags "vip,beta" --exclude-tags ""   # "" clears
bento broadcasts update 456 --segment-id none                             # clear segment

# Approve for sending. The prompt shows the time it will go out at; --confirm or
# BENTO_AUTO_CONFIRM=true skips the prompt. Needs a future send time (stored or --send-at).
bento broadcasts update 456 --approve
bento broadcasts update 456 --approve --send-at 2026-12-01T09:00:00Z
bento broadcasts update 456 --unapprove
```

Only draft and scheduled broadcasts can be edited. Paused broadcasts have already started sending,
so the API refuses them with 409, like sending, sent, and canceled ones. `--send-at` must be in the
future (checked before the request). `--approve` refuses a broadcast whose send time is missing or
has passed; pass a future `--send-at` in the same command.

`--type plain|raw` picks the editor and can be
sent on its own; replacing the body of a visual-editor broadcast needs `--type`. `--batch-size`
is 10 to 500000. On create, `--type html` and `markdown` use the raw editor, and `--from-email`
and `--author-id` are mutually exclusive.

#### Tag targeting (check before you send)

- `--include-tags a,b` sends only to subscribers who have **all** of the listed tags, not any.
- `--exclude-tags a,b` drops anyone who has **any** of the listed tags.
- Tags combine with the segment (`--segment-id`) using AND.
- Names are exact and case-sensitive. Bento **creates unknown names as new, empty tags**: a typo in
  `--include-tags` matches nobody, and a typo in `--exclude-tags` excludes nobody.
- At most 20 names per flag and 100 characters per name. The CLI refuses more (Bento would silently
  ignore the extras).
- Before sending, the CLI checks every name against `bento tags list`. If any name doesn't exist
  yet, it prints why and exits 1 (in `--json` mode: `success: false` with the details in `error`).
  Re-run with `--confirm` (or `BENTO_AUTO_CONFIRM=true`) only if you really mean to use a new tag;
  the warnings are then printed, and in `--json` mode returned in `meta.warnings`.

### Emails (render and test)

```bash
# Render + validate Liquid. Exits 1 when invalid. Never sends.
bento emails render --template-id 123
bento emails render --broadcast-id 456 --email jane@example.com   # render as a subscriber
bento emails render --subject "Hi {{ visitor.first_name }}" --html-file ./email.html \
  --preview-text "Peek" --html            # print rendered HTML instead of text
bento emails render --template-id 123 --out ./rendered.html
bento emails render --subject "Hi" --html-file ./plain.txt --type plain   # raw content editor: raw (default) or plain
bento emails render --template-id 123 --json | jq ".data.attributes.valid"

# Send a test (max 5 recipients; team members or the site's sending domains only)
bento emails test --template-id 123 --to me@acme.com,teammate@acme.com
bento emails test --broadcast-id 456 --to me@acme.com --dry-run   # render only
```

Use exactly one source: `--template-id`, `--broadcast-id`, or `--subject` with `--html-file`
(`--preview-text` and `--type` only apply to raw content; subject + HTML + preview text must
total 512KB or less). An unknown template, broadcast, or `--email` subscriber is a 404.
`--json` output: `.success` (false when invalid), `.data.attributes.valid`,
`.data.attributes.errors[]` (`{field, line, message}`), `.data.attributes.warnings[]`,
`.data.attributes.rendered.{subject,preview_text,html,text,from,to}`, `.data.attributes.rendered_as`.
Test sends: `.data.attributes.deliveries[].{to,status,job_id,queued_at}`.

### Authors

```bash
bento authors list            # IDs for --author-id
```

### Segments

```bash
bento segments list
bento segments get 12 --json
```

Segments are read-only through the API for now: creating and updating them is coming soon (the
API answers 501), so manage segments in the Bento app. `segments get` prints the segment's query
formatted (the API stores it as a JSON string), and in `--json` output
`.data.attributes.visitor_event_query` is an object. Tag rules in that query use the
`cached_tag_ids` filter with tag **ids** as values.

### Images

```bash
bento images upload ./hero.png    # prints the hosted URL
```

Accepts png, jpg/jpeg, gif, and webp up to 1MB (SVG is not allowed). Bento allows 20 image
uploads per site per day, and only for approved accounts: until your account is approved the CLI
exits 1 with a message saying so.

### Workflows

```bash
bento workflows list
bento workflows get 42                     # diagram revision + node IDs
bento workflows propose 42 \
  --patch-file ./patch.json \
  --summary "Add a 2-day wait after signup" \
  --base-revision 3f9a1c0b7e2d4a65
bento workflows proposals 42               # pending + stale proposals
```

`--patch-file` uses the same patch format as Tanuki:

```json
{
  "add_nodes": [
    { "id": "wait_2d", "type": "delay", "config": { "delay_interval_count": 2, "delay_interval": "days" }, "insert_after": "trigger_1" },
    { "id": "tag_yes", "type": "tag", "config": { "tag_name": "engaged" }, "insert_after": "split_1", "insert_after_port": "bottom_0" }
  ],
  "update_nodes": [ { "id": "email_3", "config": { "name": "Day 2 follow-up" } } ],
  "remove_nodes": [ "old_tag_1" ],
  "add_links": [ { "from": "wait_2d", "to": "email_3" } ],
  "remove_links": [ { "from": "split_1", "fromPort": "bottom_1" } ]
}
```

- `add_nodes` items are `{ id, type, config, insert_after?, insert_after_port?, insert_before? }`.
  New ids must not already exist on the flow. Connect each non-trigger node with `insert_after`
  (an existing node id, or a new node that chains back to one) or `insert_before`. For split
  nodes, `insert_after_port` is `bottom_0` (true branch) or `bottom_1` (false branch). Delay nodes
  need `delay_interval_count` and `delay_interval` in `config`; tag nodes need `tag_name`.
- `update_nodes` items are `{ id, config }`, and `config` holds only the keys you are changing.
- `remove_nodes` is a list of existing node ids. Links reconnect automatically.
- `add_links` and `update_links` items are `{ from, to, fromPort? }`. `remove_links` items are
  `{ from, fromPort?, to? }` and remove whatever leaves that port.
- `move_nodes` (`{ id, move_after | move_before }`) is accepted, but the Flow Builder does not
  apply moves yet. Avoid it; the CLI warns if you send it.
- Limits: 64KB, 200 changes in total, summary up to 500 characters, at most 20 pending proposals
  per flow (422 beyond that). camelCase keys (`addNodes`) are also accepted.
- Get node ids and the revision from `bento workflows get <id>`. In `--json` output they are
  `.data.attributes.triggers[].id`, `.data.attributes.nodes[].id`, and
  `.data.attributes.diagram_revision`.
- `--base-revision` is the 16-character `diagram_revision`. If the flow changed since then, the
  API answers 409 and the CLI prints the current revision and tells you to re-fetch the flow and
  rebuild the patch.
- On success the CLI prints the proposal id, status, absolute review URL, expiry, and any
  validator warnings. In `--json` output: `.data.id`, `.data.attributes.status`,
  `.data.attributes.review_url`, `.data.attributes.warnings[]`, `.data.attributes.created_by`.

`propose` never edits the flow. It creates a proposal and prints a review URL. The change only
takes effect after someone accepts it in the Flow Builder.

### Sequences

```bash
# List all sequences
bento sequences list

# Create a sequence email with inline HTML
bento sequences create-email \
  --sequence-id 123 \
  --subject "Welcome to Bento" \
  --html "<h1>Hi there</h1>" \
  --delay-interval days \
  --delay-count 7

# Create from an HTML file
bento sequences create-email \
  --sequence-id 123 \
  --subject "Day 2 follow-up" \
  --html-file ./emails/day-2.html

# Update an existing sequence email template
bento sequences update-email \
  --template-id 12345 \
  --subject "Updated Welcome Subject"

# Update subject + HTML inline
bento sequences update-email \
  --template-id 12345 \
  --subject "Refined Subject" \
  --html "<h1>Updated body</h1>"

# Update HTML from file
bento sequences update-email \
  --template-id 12345 \
  --html-file ./emails/updated-welcome.html

# Update the inbox preview text (alias: --preview-text)
bento sequences update-email \
  --template-id 12345 \
  --inbox-snippet "A quick note before you start"
```

Maintainer release order for this feature:
1. Ship the API endpoint in `bento`.
2. Publish a `bento-node-sdk` version that includes `createSequenceEmail`.
3. Release `bento-cli` against that SDK version.

Sequence email updates support `subject`, `html`, and `inbox_snippet`.

### Statistics

```bash
# View site-wide stats
bento stats site
```

### Agent workflow: render → test → propose

Agents (and CI) should check their work before anything reaches subscribers:

```bash
# 1. Validate Liquid and inspect the output. Non-zero exit = fix before continuing.
bento emails render --subject "$SUBJECT" --html-file draft.html --json

# 2. Send it to yourself.
bento emails test --subject "$SUBJECT" --html-file draft.html --to me@acme.com

# 3a. Apply to a draft broadcast (approval stays a separate, confirmed step).
bento broadcasts update 456 --subject "$SUBJECT" --html-file draft.html

# 3b. Flows are never edited directly: propose, then a human accepts in the Flow Builder.
bento workflows get 42 --json            # read diagram_revision + node IDs
bento workflows propose 42 --patch-file patch.json --summary "..." --base-revision "$REV"
```

File flags (`--html-file`, `--patch-file`, `--out`, `images upload`) only accept
paths inside the current working directory.

## Output Modes

| Flag | Description |
|------|-------------|
| *(none)* | Human-readable tables with colors |
| `--json` | Machine-readable JSON for scripting |
| `--quiet` | Minimal output (errors only) |

```bash
# Default: pretty tables
bento subscribers search --email user@example.com

# JSON for scripting
bento subscribers search --email user@example.com --json | jq '.data[].email'

# Quiet for automation (exit code only)
bento tags create "test-tag" --quiet && echo "Created!"
```

### JSON Response Format

All `--json` output follows a consistent schema:

```json
{
  "success": true,
  "error": null,
  "data": { ... },
  "meta": {
    "count": 10,
    "total": 100
  }
}
```

## Safety Features

Bulk operations include safety flags to prevent mistakes:

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what would happen without making changes |
| `--limit <n>` | Only process the first N items |
| `--sample <n>` | Show N sample items in the preview |
| `--confirm` | Skip interactive confirmation (for scripts) |

```bash
# Preview an import without executing
bento subscribers import big-list.csv --dry-run

# Import only the first 10 rows to test
bento subscribers import big-list.csv --limit 10

# Tag subscribers non-interactively (CI/scripts)
bento subscribers tag --file users.csv --add customer --confirm
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BENTO_CONFIG_PATH` | Override config file location |
| `BENTO_API_BASE_URL` | Override API endpoint (for testing) |
| `BENTO_AUTO_CONFIRM` | Set to `true` to skip all confirmations |
| `DEBUG` | Set to `bento` for verbose SDK logging |

## CSV Format

### For Subscriber Imports

CSV files must have an `email` column (case-insensitive). The CLI recognizes these special columns:

| Column | Description |
|--------|-------------|
| `email` | **Required**. Subscriber email address |
| `name` | Optional. Subscriber display name |
| `tags` | Optional. Tags to add (comma or semicolon separated) |
| `remove_tags` | Optional. Tags to remove (comma or semicolon separated) |
| *(other)* | Any other columns become custom fields |

**Basic import with custom fields:**
```csv
email,first_name,last_name,plan
alice@example.com,Alice,Smith,pro
bob@example.com,Bob,Jones,starter
```

**Import with inline tag assignment:**
```csv
email,name,tags,remove_tags,company
jesse@example.com,Jesse Hanley,"customer,mql",lead,Acme Inc
alice@example.com,Alice Smith,"newsletter,active",,Widgets Co
```

### For Email Lists (tag/unsubscribe operations)

A simple CSV with an `email` column:

```csv
email
alice@example.com
bob@example.com
```

Or a plain text file with one email per line (no header needed):

```
alice@example.com
bob@example.com
```

**Note:** Email lists are automatically deduplicated and normalized to lowercase.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments or usage |
| 6 | CSV parsing error |

## Examples

### CI/CD: Sync subscribers from your database

```bash
#!/bin/bash
# Export active users and sync to Bento

psql -c "COPY (SELECT email, name FROM users WHERE active) TO STDOUT CSV HEADER" \
  > /tmp/active-users.csv

# Using npx (no install required)
npx @bentonow/bento-cli subscribers import /tmp/active-users.csv --confirm --json

# Or if installed globally
bento subscribers import /tmp/active-users.csv --confirm --json
```

### Scripting: Tag users based on activity

```bash
#!/bin/bash
# Tag users who haven't been active

# Check if a subscriber has the "inactive" tag
bento subscribers search --email user@example.com --tag inactive --json \
  | jq -r '.data[].email' \
  | while read email; do
      bento subscribers tag --email "$email" --add "needs-reengagement" --confirm
    done
```

### Automation: Track events from webhooks

```bash
# In your webhook handler
curl -X POST https://your-server.com/webhook -d '{"email": "user@example.com", "event": "purchase"}'

# Handler script
bento events track \
  --email "$WEBHOOK_EMAIL" \
  --event "$WEBHOOK_EVENT" \
  --details "$WEBHOOK_DETAILS"
```

## Development

```bash
# Clone the repository
git clone https://github.com/bentonow/bento-cli.git
cd bento-cli

# Install dependencies
bun install

# Run CLI locally
bun run dev

# Run tests
bun test

# Lint and format
bun lint
bun format
```

## Claude Code Skill

This repository includes a [Claude Code](https://claude.ai/code) skill that provides guidance for using the Bento CLI. The skill teaches Claude about all available commands, safety patterns, and best practices.

### Installing the Skill

To install the bento-cli skill for Claude Code:

```bash
# Navigate to your Claude Code skills directory
cd ~/.claude/skills

# Clone the skill (or symlink from your local clone)
git clone https://github.com/bentonow/bento-cli.git bento-cli-repo
ln -s bento-cli-repo/skill bento-cli

# Or copy directly
cp -r /path/to/bento-cli/skill ~/.claude/skills/bento-cli
```

Alternatively, if you're working within the bento-cli repository, the skill is automatically available at `skill/SKILL.md`.

### What the Skill Provides

- **Command reference**: All CLI commands with options and examples
- **Safety-first philosophy**: Guidance on `--dry-run`, `--limit`, and `--confirm` flags
- **Anti-patterns**: Common mistakes to avoid with bulk operations
- **Workflows**: CI/CD integration, scripting patterns, safe import validation

## Requirements

- **Runtime**: [Bun](https://bun.sh) >= 1.0.0 or Node.js >= 18
- **Bento Account**: [Sign up](https://bentonow.com) if you don't have one

## Support

- **Documentation**: [docs.bentonow.com](https://docs.bentonow.com)
- **Issues**: [GitHub Issues](https://github.com/bentonow/bento-cli/issues)
- **Community**: [Discord](https://discord.gg/bento)

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with love by the [Bento](https://bentonow.com) team.
