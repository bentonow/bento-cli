# Bento CLI Command Reference

Complete reference for all Bento CLI commands with options and examples.

## Global Options

These options work with most commands:

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format for scripting |
| `--quiet` | Minimal output (errors only) |
| `--help` | Show help for any command |

## auth

Authentication management commands.

### auth login

Authenticate with Bento API credentials.

```bash
# Interactive (prompts for credentials)
bento auth login

# Non-interactive (all flags required)
bento auth login \
  --publishable-key <key> \
  --secret-key <key> \
  --site-uuid <uuid>

# With custom profile name
bento auth login --profile production \
  --publishable-key <key> \
  --secret-key <key> \
  --site-uuid <uuid>
```

**Options**:
| Option | Description |
|--------|-------------|
| `--publishable-key <key>` | Bento publishable API key |
| `--secret-key <key>` | Bento secret API key |
| `--site-uuid <uuid>` | Bento site UUID |
| `--profile <name>` | Profile name (default: "default") |

### auth status

Show current authentication status.

```bash
bento auth status
bento auth status --json
```

### auth logout

Clear current authentication and remove profile.

```bash
bento auth logout
bento auth logout --json
```

---

## profile

Manage multiple Bento account profiles.

### profile add

Add a new named profile (prompts for credentials).

```bash
bento profile add production
bento profile add staging
```

### profile use

Switch to a different profile.

```bash
bento profile use staging
bento profile use production
```

### profile list

List all configured profiles.

```bash
bento profile list
bento profile list --json
```

### profile remove

Remove a profile.

```bash
bento profile remove staging
```

---

## subscribers

Subscriber management commands.

### subscribers search

Search for subscribers with various filters.

```bash
# By email
bento subscribers search --email user@example.com

# By tag
bento subscribers search --tag vip
bento subscribers search --tag active

# By custom field
bento subscribers search --field plan=pro
bento subscribers search --field company=Acme

# Pagination
bento subscribers search --tag vip --page 2 --per-page 50
```

**Options**:
| Option | Description |
|--------|-------------|
| `--email <email>` | Filter by email address |
| `--tag <tag>` | Filter by tag name |
| `--field <key=value>` | Filter by custom field |
| `--page <n>` | Page number (default: 1) |
| `--per-page <n>` | Results per page (default: 25) |

### subscribers import

Import subscribers from a CSV file.

```bash
# Basic import (interactive confirmation)
bento subscribers import contacts.csv

# Preview without making changes
bento subscribers import contacts.csv --dry-run

# Import first N rows only
bento subscribers import contacts.csv --limit 100

# Non-interactive (for scripts)
bento subscribers import contacts.csv --confirm

# Full workflow
bento subscribers import contacts.csv --dry-run           # 1. Preview
bento subscribers import contacts.csv --limit 10 --confirm # 2. Test batch
bento subscribers import contacts.csv --confirm           # 3. Full import
```

**Options**:
| Option | Description |
|--------|-------------|
| `--dry-run` | Preview without executing |
| `--limit <n>` | Process only first N rows |
| `--sample <n>` | Show N sample rows in preview |
| `--confirm` | Skip interactive confirmation |

**CSV Format**:
- Must have `email` column (case-insensitive)
- Special columns: `name`, `tags`, `remove_tags`
- `tags`/`remove_tags` support comma or semicolon separators
- Other columns become custom fields
- First row is header

```csv
email,name,tags,remove_tags,plan
alice@example.com,Alice Smith,"customer,active",,pro
bob@example.com,Bob Jones,newsletter,trial,starter
```

### subscribers tag

Add or remove tags from subscribers.

```bash
# Single subscriber
bento subscribers tag --email user@example.com --add vip
bento subscribers tag --email user@example.com --remove trial
bento subscribers tag --email user@example.com --add vip,premium --remove trial

# Bulk from CSV
bento subscribers tag --file users.csv --add customer --confirm
bento subscribers tag --file users.csv --add customer,active --dry-run
```

**Options**:
| Option | Description |
|--------|-------------|
| `--email <email>` | Target single subscriber |
| `--file <path>` | CSV file with emails |
| `--add <tags>` | Comma-separated tags to add |
| `--remove <tags>` | Comma-separated tags to remove |
| `--dry-run` | Preview without executing |
| `--confirm` | Skip interactive confirmation |

### subscribers unsubscribe

Unsubscribe subscribers (stop email delivery).

```bash
# Single subscriber
bento subscribers unsubscribe --email user@example.com

# Bulk from CSV
bento subscribers unsubscribe --file unsubscribes.csv --dry-run
bento subscribers unsubscribe --file unsubscribes.csv --confirm
```

**Options**:
| Option | Description |
|--------|-------------|
| `--email <email>` | Target single subscriber |
| `--file <path>` | CSV file with emails |
| `--dry-run` | Preview without executing |
| `--confirm` | Skip interactive confirmation |

### subscribers subscribe

Re-subscribe a previously unsubscribed subscriber.

```bash
bento subscribers subscribe --email user@example.com
```

### subscribers activity

Engagement summary (event count, last open/click/visit, last engagement) and recent events.

```bash
bento subscribers activity user@example.com
bento subscribers activity --uuid 4f1c... --limit 50
bento subscribers activity user@example.com --json
```

**Options**:
| Option | Description |
|--------|-------------|
| `[email]` | Subscriber email (or use `--uuid`) |
| `--uuid <uuid>` | Look up by subscriber UUID |
| `--limit <n>` | Recent events to return, 1-100 (default 25) |

---

## tags

Tag management commands.

### tags list

List all tags in the account.

```bash
bento tags list
bento tags list --json
```

### tags create

Create a new tag.

```bash
bento tags create "new-feature-announcement"
bento tags create newsletter
bento tags create "customer-tier-gold"
```

### tags delete

Delete a tag.

```bash
bento tags delete "old-tag" --confirm
```

**Note**: Tag deletion may have API limitations. Check the output for details.

---

## fields

Custom field management commands.

### fields list

List all custom fields.

```bash
bento fields list
bento fields list --json
```

### fields create

Create a new custom field.

```bash
bento fields create company_size
bento fields create plan_type
```

---

## events

Event tracking commands.

### events track

Track a custom event for a subscriber.

```bash
# Simple event
bento events track --email user@example.com --event signed_up

# Event with details (JSON)
bento events track \
  --email user@example.com \
  --event purchase \
  --details '{"product": "Pro Plan", "amount": 99}'

# Event with complex details
bento events track \
  --email user@example.com \
  --event order_completed \
  --details '{"order_id": "12345", "items": ["SKU001", "SKU002"], "total": 149.99}'
```

**Options**:
| Option | Description |
|--------|-------------|
| `--email <email>` | Subscriber email (required) |
| `--event <name>` | Event name (required) |
| `--details <json>` | Event details as JSON string |

---

## broadcasts

Broadcast management commands.

### broadcasts list

List all broadcasts.

```bash
bento broadcasts list
bento broadcasts list --json
```

### broadcasts get

Show one broadcast: subject, preview text, author, audience (segments, tags), schedule,
approval, and status.

```bash
bento broadcasts get 456
bento broadcasts get 456 --json
```

### broadcasts create

Create a new broadcast draft.

```bash
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
```

**Options**:
| Option | Description |
|--------|-------------|
| `--name <name>` | Broadcast name (required) |
| `--subject <subject>` | Email subject line (required) |
| `--content <html>` | Email content |
| `--type <type>` | Content type: plain, html, markdown (default html) |
| `--from-name <name>` / `--from-email <email>` | Sender (alternative to `--author-id`) |
| `--author-id <id>` | Sender author ID from `bento authors list` |
| `--preview-text <text>` | Inbox preview text |
| `--segment-id <id>` | Segment to target |
| `--include-tags <tags>` | Comma-separated tags to include (sent as an array) |
| `--exclude-tags <tags>` | Comma-separated tags to exclude (sent as an array) |
| `--send-at <iso>` | Schedule time (ISO 8601) |
| `--batch-size <n>` | Emails per hour (default 1000) |

### broadcasts update

Update a draft, scheduled, or paused broadcast. Sending, sent, and canceled broadcasts return 409.

```bash
bento broadcasts update 456 --subject "New subject" --html-file ./jan.html
bento broadcasts update 456 --include-tags "vip,beta" --exclude-tags ""
bento broadcasts update 456 --segment-id none
bento broadcasts update 456 --approve --confirm
```

**Options**:
| Option | Description |
|--------|-------------|
| `--name <name>` | Broadcast name |
| `--subject <subject>` | Subject line |
| `--html-file <path>` | Replace the body with this file |
| `--type <type>` | Content type for `--html-file`: plain, raw |
| `--preview-text <text>` | Inbox preview text |
| `--author-id <id>` | Sender author ID |
| `--segment-id <id>` | Segment ID, or `none` to clear |
| `--include-tags <tags>` / `--exclude-tags <tags>` | Comma-separated; `""` clears |
| `--send-at <iso>` | Schedule time (ISO 8601) |
| `--batch-size <n>` | Emails per hour |
| `--approve` / `--unapprove` | Approve for sending (prompts) or revoke approval |
| `--confirm` | Skip the approval prompt |

---

## emails

Render, validate, and test-send emails. Each command takes exactly one source:
`--template-id <id>`, `--broadcast-id <id>`, or `--subject <s>` + `--html-file <path>`
(optionally `--preview-text <text>`). `--email <subscriber>` renders as that subscriber
(default: the site's sample subscriber).

### emails render

Render and validate Liquid. Never sends. Exits 1 when the email is invalid.

```bash
bento emails render --template-id 123
bento emails render --broadcast-id 456 --email jane@example.com --html
bento emails render --subject "Hi {{ visitor.first_name }}" --html-file draft.html --out out.html
bento emails render --template-id 123 --json    # success=false when invalid
```

**Options**:
| Option | Description |
|--------|-------------|
| `--html` | Print rendered HTML instead of the text body |
| `--out <file>` | Write rendered HTML to a file |

### emails test

Send the rendered email to up to 5 addresses. Recipients must be team members or on the site's
sending domains. Invalid Liquid is refused (422); disallowed recipients return 403; the daily
preview limit returns 429.

```bash
bento emails test --template-id 123 --to me@acme.com,teammate@acme.com
bento emails test --template-id 123 --to me@acme.com --dry-run   # render only
```

**Options**:
| Option | Description |
|--------|-------------|
| `--to <emails>` | Comma-separated recipients, max 5 (required) |
| `--dry-run` | Render and validate only |

---

## authors

### authors list

List authors (senders). Use the ID with `--author-id`.

```bash
bento authors list
bento authors list --page 2 --json
```

---

## segments

### segments list / get

```bash
bento segments list
bento segments get 12
bento segments get 12 --json     # includes visitor_event_query
```

### segments create / update

```bash
bento segments create --name "Engaged VIPs" --description "VIPs who clicked" --query-file vip.json
bento segments update 12 --query-file vip.json
```

`--query-file` is a JSON QueryBuilder group (same shape as `data.attributes.visitor_event_query`):

```json
{ "condition": "AND", "rules": [
  { "id": "tags", "field": "tags", "operator": "contains", "value": "vip", "data": { "groupType": "visitor" } }
] }
```

**Options**:
| Option | Description |
|--------|-------------|
| `--name <name>` | Segment name (required for create) |
| `--description <text>` | Description |
| `--query-file <path>` | QueryBuilder JSON (validated by the API) |

---

## images

### images upload

Upload a png, jpg/jpeg, gif, or webp (max 1MB; SVG is not allowed) and print the hosted URL.
Bento allows 20 uploads per site per day; past that the CLI exits 1 with a "try again tomorrow"
message.

```bash
bento images upload ./hero.png
bento images upload ./hero.png --json
```

---

## sequences

### sequences list

```bash
bento sequences list
bento sequences list --json
```

### sequences create-email

Append an email template to a sequence.

```bash
bento sequences create-email \
  --sequence-id 123 \
  --subject "Welcome to Bento" \
  --html-file ./emails/welcome.html \
  --inbox-snippet "Start here" \
  --delay-interval days \
  --delay-count 2
```

**Options**:
| Option | Description |
|--------|-------------|
| `--sequence-id <id>` / `--sequence-name <name>` | Target sequence (exactly one) |
| `--subject <subject>` | Subject line (required) |
| `--html <html>` / `--html-file <path>` | Body (exactly one) |
| `--inbox-snippet <text>` | Inbox preview text |
| `--delay-interval <interval>` | minutes, hours, days, months (with `--delay-count`) |
| `--delay-count <n>` | 1-999 (with `--delay-interval`) |
| `--editor-choice <choice>` | plain, fancy, or raw |
| `--cc`, `--bcc`, `--to` | Recipient overrides (Liquid allowed) |

### sequences update-email

Patch an existing template by ID.

```bash
bento sequences update-email --template-id 12345 --subject "Updated subject"
bento sequences update-email --template-id 12345 --html-file ./emails/v2.html
bento sequences update-email --template-id 12345 --inbox-snippet "New preview text"
```

**Options**:
| Option | Description |
|--------|-------------|
| `--template-id <id>` | Template ID (required) |
| `--subject <subject>` | New subject |
| `--html <html>` / `--html-file <path>` | New body (at most one) |
| `--inbox-snippet <text>` | New inbox preview text (alias `--preview-text`) |

---

## workflows

Flows are never edited directly. Agents propose changes; a human accepts them in the Flow Builder.

### workflows list / get

```bash
bento workflows list
bento workflows get 42           # name, status, diagram_revision, node IDs
bento workflows get 42 --json
```

### workflows propose

```bash
bento workflows propose 42 \
  --patch-file ./patch.json \
  --summary "Add a 2-day wait and a follow-up email after signup" \
  --base-revision abc123
```

Prints the proposal status and review URL. Proposals expire after 7 days.

**Options**:
| Option | Description |
|--------|-------------|
| `--patch-file <path>` | JSON patch (`add_nodes`, `update_nodes`, `remove_nodes`, `add_links`, `remove_links`), validated by the API (required) |
| `--summary <text>` | Description shown to the reviewer (required) |
| `--base-revision <rev>` | `diagram_revision` from `workflows get`; marks the proposal stale if the flow changes |

**Patch format** (same as Tanuki):

```json
{
  "add_nodes": [
    { "id": "wait_2d", "type": "delay", "config": { "delay_interval_count": 2, "delay_interval": "days" }, "insert_after": "trigger_1" },
    { "id": "yes_email", "type": "email", "config": { "subject": "Welcome aboard" }, "insert_after": "split_1", "insert_after_port": "bottom_0" }
  ],
  "update_nodes": [ { "id": "email_3", "config": { "subject": "New subject" } } ],
  "remove_nodes": [ "old_tag_1" ],
  "add_links": [ { "from": "wait_2d", "to": "email_3" } ],
  "remove_links": [ { "from": "split_1", "fromPort": "bottom_1" } ]
}
```

- `add_nodes` items need `id`, `type`, and `config`. Connect each non-trigger node with
  `insert_after` (an existing node ID, or a new node that chains back to one) or `insert_before`.
  For split nodes, `insert_after_port` is `bottom_0` (true) or `bottom_1` (false). Delay nodes need
  `delay_interval_count` and `delay_interval` in `config`.
- `update_nodes` items are `{ id, config }`, and `config` holds only the keys you are changing.
- `remove_nodes` is a list of existing node IDs. Links reconnect automatically.
- `add_links` items are `{ from, to, fromPort? }`. `remove_links` items are `{ from, fromPort?, to? }`.
- Get node IDs from `bento workflows get <id> --json`.

### workflows proposals

```bash
bento workflows proposals 42     # pending + stale proposals
```

---

## Agent workflow: render → test → propose

```bash
bento emails render --subject "$SUBJECT" --html-file draft.html --json     # exit 1 = fix first
bento emails test --subject "$SUBJECT" --html-file draft.html --to me@acme.com
bento broadcasts update 456 --subject "$SUBJECT" --html-file draft.html     # approve separately
bento workflows propose 42 --patch-file patch.json --summary "..." --base-revision "$REV"
```

File flags (`--html-file`, `--query-file`, `--patch-file`, `--out`, `images upload`) only accept
paths inside the current working directory.

---

## stats

Statistics commands.

### stats site

View site-wide statistics.

```bash
bento stats site
bento stats site --json
```
