# Document Review Process Before Committing

## Purpose

Before committing research documents, review for common false positives from spell checkers and ensure technical accuracy.

## Quick Workflow with git wdu

**Recommended git alias** (add to `~/.gitconfig`):
```ini
[alias]
    wdu = "!f() { base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed \"s@^refs/remotes/origin/@@\"); if [ -n \"$base\" ]; then git diff --color-words \"$base\"...; else echo \"Could not determine base branch\"; fi; }; f"
```

**Then before committing:**
```bash
# 1. Stage your changes
git add issue-2/

# 2. Review with word diff
git wdu -- issue-2/
# or: git diff --word-diff=plain --cached

# 3. Look for problems (see checklist below)

# 4. If clean, commit
git commit -m "Add research for issue #2"
```

## Common Issues to Check

### 1. Regex Patterns (Should NOT be "fixed")

**Example issue:** URL regexes in code or documentation
```
# Correct (in documentation):
ignore-regex = https?://\S+

# Incorrect if "fixed" to:
ignore-regex = https://\S+  # Lost the optional 's'
```

**What to do:**
- Mark regex patterns with inline skip comments for spell checkers
- In markdown code blocks, regexes are usually safe
- In prose, use backticks: `https?://\S+`

### 2. CamelCase Technical Terms

**Example issues:**
- `emailAaddress` ← typo, should be `emailAddress`
- `currentY` ← typo, should be `currently` or `currentYear`
- `postValidateAaddress` ← typo, should be `postValidateAddress` (real example from grobid-core)

**Pattern to watch for:** Doubled letters in CamelCase (e.g., `Aaddress`, `Eemail`)

**What to check:**
- Variable names in code examples
- Method/function names
- Technical terms and project names
- Verify CamelCase is intentional, not a spelling error

**Detection command:**
```bash
# Find potential CamelCase typos with doubled letters
git diff --color-words main... | grep -E '[A-Z][a-z]*[A-Z]{2}|[A-Z][a-z]+[a-z]{2}[a-z]+'
```

### 3. Tool/Project Names (Should NOT be changed)

**Correct spellings (don't "fix"):**
- `git-annex` (not "git-annex")
- `annextube` (CON tool, not "annex tube")
- `con/tinuous` (CON tool, not "continuous")
- `con/duct` (CON tool, not "conduct")
- `Forgejo-aneksajo` (Esperanto: "aneksaĵo" = "annex")
- `slackdump` (tool name, not "slack dump")
- `yt-dlp` (tool name, not "YouTube-dlp")

### 4. URLs in Documentation

**Issue:** URLs should NEVER be corrected, even if they contain typos

**Example:**
```markdown
# Real GitHub URL with typo in repo name:
https://github.com/vllm-project/vllm/.../reproduciblity.py

# DO NOT "fix" to:
https://github.com/vllm-project/vllm/.../reproducibility.py
# ^ This breaks the link!
```

**From your CLAUDE.md:**
> URLs should NEVER be "fixed" even if they contain typos, as this breaks links

**Codespell config:**
```ini
ignore-regex = https?://\S+
```

### 5. Short Variable Names

**Example whitelisted terms:**
- `eles` - short for "elements"
- `ans` - short for "answer"
- `nd` - short for "no_decay" or "2nd"

**What to do:**
- Don't "fix" common abbreviations
- Check context before changing

## Review Checklist

Before committing documentation:

- [ ] Run word-diff review if available
- [ ] Check regex patterns are not "corrected"
- [ ] Verify technical terms (git-annex, DataLad, etc.)
- [ ] Check CamelCase for typos (emailAaddress, currentY)
- [ ] Ensure URLs are untouched
- [ ] Verify tool names are correct (annextube, con/tinuous)
- [ ] Check code blocks for unintended changes
- [ ] Review inline code (backticks) for accuracy

## Review Process

### Step 1: Generate word diff (if comparing to upstream)

**Using the `wdu` git alias (recommended):**

```bash
# Add this alias to your ~/.gitconfig:
[alias]
    wdu = "!f() { base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed \"s@^refs/remotes/origin/@@\"); if [ -n \"$base\" ]; then git diff --color-words \"$base\"...; else echo \"Could not determine base branch\"; fi; }; f"

# Then use:
git wdu

# Or for specific files:
git wdu -- issue-2/
```

**Manual alternative:**
```bash
git diff --color-words main... -- issue-2/
```

### Step 2: Look for false positives

**Red flags:**
- Regex patterns changed (e.g., `s?` removed from `https?://`)
- Tool names altered (e.g., `annextube` → `annex tube`)
- URLs modified
- Technical CamelCase "fixed" incorrectly

### Step 3: Review specific patterns

Using `git wdu` or word diff, look for problematic patterns:

```bash
# Check for regex patterns (should not be "fixed")
git wdu | grep -E "https?\|ignore-regex"

# Check for tool names (should be preserved)
git wdu | grep -E "annextube|con/tinuous|con/duct|git-annex"

# Check for CamelCase typos (doubled letters)
git wdu | grep -E '\[-[A-Za-z]*[Aa]{2}[a-z]*-\]|\[-[A-Za-z]*[Ee]{2}[a-z]*-\]'

# Examples that would be caught:
# [-emailAaddress-]{+emailAddress+}     ✓ Caught (Aa → A)
# [-postValidateAaddress-]{+postValidateAddress+}  ✓ Caught
# [-currentY-]{+currently+}             ✓ Caught

# Check for URL modifications (should never happen)
git wdu | grep -E 'https?://.*\[-.*-\]'

# If this shows results, URLs were modified - REVERT!
```

**Interpreting word diff output:**
- `[-removed text-]` in red - was in base branch
- `{+added text+}` in green - new in your changes

**Red flags in word diff:**
- Regex patterns changed: `[-https?://-]{+https://+}` ← Lost the `?`
- URLs modified: Any `[-...-]` inside a URL ← Breaks the link
- Tool names changed: `[-annextube-]{+annex tube+}` ← Wrong
- CamelCase typos: `[-Address-]{+Aaddress+}` ← Introduced typo

### Step 4: Identify false positives in word diff

**Workflow after running spell checker:**

```bash
# 1. Stage your changes
git add issue-2/

# 2. Review word diff against base branch
git wdu -- issue-2/

# 3. Look for RED FLAGS:
#    - Regex patterns changed
#    - URLs modified
#    - Tool names altered
#    - CamelCase typos (Aaddress, Eemail)

# 4. If false positives found, search for specific pattern:
git wdu -- issue-2/ | grep -C 3 "Aaddress"

# 5. This shows context around the problem
```

**Example output analysis:**

```diff
# GOOD - Real typo fixed:
[-postValidateAaddress-]{+postValidateAddress+}
✓ This is correct: Aaddress → Address

# BAD - Regex broken:
[-ignore-regex = https?://\S+-]{+ignore-regex = https://\S++}
✗ This broke the regex: lost optional 's'

# BAD - URL modified:
[-https://github.com/vllm-project/vllm/.../reproduciblity.py-]
{+https://github.com/vllm-project/vllm/.../reproducibility.py+}
✗ This breaks the link! URL must not be changed.

# BAD - Tool name changed:
[-annextube-]{+annex tube+}
✗ Tool name should stay as one word
```

### Step 5: Fix false positives

If spell checker introduced errors:
1. Identify the incorrect changes (using `git wdu`)
2. Revert specific words/patterns
3. Add to whitelist if applicable
4. Re-run spell checker with updated config
5. Re-review with `git wdu` to confirm fixes

### Step 5: Manual spot check

Open 2-3 random files and:
- Skim for obvious typos
- Check technical terms are accurate
- Verify code examples are correct
- Ensure links work

## Integration with Workflow

### For new documents:
1. Write content
2. Self-review using checklist
3. Run spell checker (if available)
4. Review diff for false positives
5. Commit

### For spell-checker runs:
1. Run codespell or similar
2. **BEFORE accepting changes:**
   - Review word diff
   - Check for false positives (regexes, tool names, URLs)
   - Adjust whitelist as needed
3. Re-run and verify
4. Commit

## Automation Ideas

### Pre-commit hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for .npm directory
if git diff --cached --name-only | grep -q "^\.npm/"; then
    echo "ERROR: .npm directory should not be committed"
    echo "Add to .gitignore: .npm/"
    exit 1
fi

# Check for common typo patterns
if git diff --cached | grep -E "emailAaddress|currentY"; then
    echo "WARNING: Possible typo detected in commit"
    echo "Review changes before committing"
fi
```

### Codespell configuration
```ini
# .codespellrc
[codespell]
skip = .git,.npm,*.pyc
ignore-regex = https?://\S+
ignore-words-list = eles,ans,nd,aneksajo,annextube
```

## Real Example: Reviewing issue-2/ Files

### Actual review performed (2026-02-05):

**Command run:**
```bash
git add issue-2/ .gitignore
git diff --word-diff=plain --cached | head -150
```

**What git wdu showed:**
- All new files: everything appears as `{+added content+}`
- No `[-removed-]` sections = no spell checker had run yet
- No false positives to fix

**Patterns verified:**

1. **CamelCase examples in REVIEW-PROCESS.md:**
   ```
   - `emailAaddress` ← typo, should be `emailAddress`
   - `postValidateAaddress` ← typo, should be `postValidateAddress`
   ```
   ✓ These are DOCUMENTED as examples of typos (correct usage)

2. **Tool names preserved:**
   - `annextube` (not split to "annex tube")
   - `con/tinuous` (not changed to "continuous")
   - `git-annex` (hyphen intact)

3. **URLs intact:**
   - All GitHub links, documentation URLs preserved
   - No "corrections" applied to URLs

4. **Technical terms correct:**
   - `Forgejo-aneksajo` (Esperanto preserved)
   - `DataLad` (CamelCase correct)
   - `MinIO` (capitalization correct)

**Result:** ✓ Ready to commit

### What to check in issue-2/ documents (template):

1. **Tool names preserved:**
   - ✅ `annextube` (not changed)
   - ✅ `con/tinuous` (not changed)
   - ✅ `con/duct` (not changed)
   - ✅ `git-annex` (not changed)

2. **URLs intact:**
   - ✅ All GitHub/doc URLs preserved
   - ✅ No typo corrections in URLs

3. **Technical terms correct:**
   - ✅ `Forgejo-aneksajo` (Esperanto preserved)
   - ✅ `DataLad` CamelCase intact
   - ✅ `MinIO` capitalization correct

4. **Code examples:**
   - ✅ Regex patterns in code blocks
   - ✅ Variable names in examples
   - ✅ Command-line syntax

## Summary

**Key principle:** Technical documentation requires careful review because:
- Spell checkers don't understand regexes
- Tool names may look like typos
- URLs must never be altered
- Technical terms have specific spelling

**Always review the final diff before committing**, especially after:
- Spell checker runs
- Automated formatting
- Large edits
- Copy-paste from other sources

## Adding This to Workflow

This review process should become habit:
1. Write → Review → Commit (not Write → Commit)
2. Generate diff → Check false positives → Commit
3. Use checklist for significant changes

**Time investment:** 2-5 minutes per commit
**Value:** Prevents broken links, incorrect terms, and embarrassing typos
