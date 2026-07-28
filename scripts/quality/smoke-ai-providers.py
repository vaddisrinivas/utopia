#!/usr/bin/env python3
"""Smoke-test Utopia AI provider keys without printing secrets."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def load_env(paths: list[Path]) -> dict[str, str]:
    env: dict[str, str] = dict(os.environ)
    for path in paths:
        if not path.exists():
            continue
        for raw in path.read_text(errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.removeprefix("export ").strip()
            value = value.strip().strip('"').strip("'")
            if value and key not in env:
                env[key] = value
    return env


def post_json(url: str, headers: dict[str, str], payload: dict, timeout: int = 25) -> tuple[int | str, str]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")[:500]
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")[:500]
    except Exception as error:  # noqa: BLE001 - smoke reports provider reachability.
        return "ERR", f"{type(error).__name__}: {str(error)[:160]}"


def test_openai_compatible(
    working: list[dict],
    label: str,
    base_url: str,
    api_key: str | None,
    models: list[str],
    extra_headers: dict[str, str] | None = None,
) -> None:
    if not api_key:
        print(f"{label}\tFAIL\tmissing key")
        return
    endpoint = base_url.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", **(extra_headers or {})}
    last = "not attempted"
    for model in models:
        status, text = post_json(
            endpoint,
            headers,
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Return JSON only."},
                    {"role": "user", "content": f'Return {{"ok":true,"provider":"{label}"}}'},
                ],
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "max_tokens": 80,
            },
        )
        last = f"{model} status {status}"
        if isinstance(status, int) and 200 <= status < 300 and "ok" in text.lower():
            print(f"{label}\tOK\t{last}")
            working.append(
                {
                    "label": label,
                    "provider": "openai_compatible",
                    "base_url": base_url,
                    "api_key": api_key,
                    "model": model,
                    "api_version": "",
                },
            )
            return
    print(f"{label}\tFAIL\t{last}")


def test_anthropic(working: list[dict], api_key: str | None) -> None:
    if not api_key:
        print("Anthropic\tFAIL\tmissing key")
        return
    last = "not attempted"
    for model in ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-sonnet-5"]:
        status, text = post_json(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            {
                "model": model,
                "max_tokens": 80,
                "system": "Return JSON only.",
                "messages": [{"role": "user", "content": 'Return {"ok":true,"provider":"anthropic"}'}],
            },
        )
        last = f"{model} status {status}"
        if isinstance(status, int) and "credit balance is too low" in text.lower():
            print(f"Anthropic\tBLOCKED_BILLING\t{last}")
            return
        if isinstance(status, int) and 200 <= status < 300 and "ok" in text.lower():
            print(f"Anthropic\tOK\t{last}")
            working.append(
                {
                    "label": "Anthropic",
                    "provider": "anthropic",
                    "base_url": "https://api.anthropic.com",
                    "api_key": api_key,
                    "model": model,
                    "api_version": "2023-06-01",
                },
            )
            return
    print(f"Anthropic\tFAIL\t{last}")


def test_azure(
    working: list[dict],
    label: str,
    base_url: str | None,
    api_key: str | None,
    api_version: str | None,
    deployments: list[str],
) -> None:
    if not base_url or not api_key or not api_version:
        print(f"{label}\tFAIL\tmissing base/key/version")
        return
    last = "not attempted"
    for deployment in deployments:
        endpoint = base_url.rstrip("/") + f"/openai/deployments/{deployment}/chat/completions?api-version={api_version}"
        status, text = post_json(
            endpoint,
            {"api-key": api_key},
            {
                "messages": [
                    {"role": "system", "content": "Return JSON only."},
                    {"role": "user", "content": 'Return {"ok":true,"provider":"azure"}'},
                ],
                "response_format": {"type": "json_object"},
                "max_completion_tokens": 80,
            },
        )
        last = f"{deployment} status {status}"
        if isinstance(status, int) and 200 <= status < 300 and "ok" in text.lower():
            print(f"{label}\tOK\t{last}")
            working.append(
                {
                    "label": label,
                    "provider": "azure_openai",
                    "base_url": base_url,
                    "api_key": api_key,
                    "model": deployment,
                    "api_version": api_version,
                },
            )
            return
    print(f"{label}\tFAIL\t{last}")


def add_if_present(configs: list[dict], label: str, provider: str, base_url: str | None, api_key: str | None, model: str | None, api_version: str = "") -> None:
    if not base_url or not api_key or not model:
        return
    configs.append(
        {
            "label": label,
            "provider": provider,
            "base_url": base_url,
            "api_key": api_key,
            "model": model,
            "api_version": api_version,
        },
    )


def available_provider_configs(env: dict[str, str]) -> list[dict]:
    configs: list[dict] = []
    # Put the routes that were most reliable in front, but keep every available key in rotation.
    add_if_present(
        configs,
        "Gemini",
        "openai_compatible",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        env.get("GEMINI_API_KEY") or env.get("GOOGLE_API_KEY"),
        "gemini-2.5-flash",
    )
    add_if_present(
        configs,
        "OpenRouter",
        "openai_compatible",
        "https://openrouter.ai/api/v1",
        env.get("OPENROUTER_API_KEY"),
        "openai/gpt-oss-20b:free",
    )
    add_if_present(
        configs,
        "LiteLLM",
        "openai_compatible",
        env.get("LITELLM_URL") or env.get("LITELLM_BASE_URL"),
        env.get("LITELLM_API_KEY") or env.get("LITELLM_MASTER_KEY"),
        env.get("LITELLM_MODEL") or "cc-litellm-chat-latest",
    )
    add_if_present(
        configs,
        "OpenAI",
        "openai_compatible",
        "https://api.openai.com/v1",
        env.get("OPENAI_API_KEY"),
        "gpt-5.4-mini",
    )
    add_if_present(
        configs,
        "Anthropic",
        "anthropic",
        "https://api.anthropic.com",
        env.get("ANTHROPIC_API_KEY"),
        "claude-haiku-4-5-20251001",
        "2023-06-01",
    )
    add_if_present(
        configs,
        "Z.ai",
        "openai_compatible",
        env.get("ZAI_API_BASE") or env.get("ZAI_BASE_URL") or "https://api.z.ai/api/coding/paas/v4",
        env.get("ZAI_API_KEY"),
        env.get("ZAI_FALLBACK_MODEL") or "glm-4.6",
    )
    add_if_present(
        configs,
        "Groq",
        "openai_compatible",
        "https://api.groq.com/openai/v1",
        env.get("GROQ_API_KEY"),
        "llama-3.3-70b-versatile",
    )
    add_if_present(
        configs,
        "xAI",
        "openai_compatible",
        "https://api.x.ai/v1",
        env.get("XAI_API_KEY") or env.get("GROK_API_KEY"),
        "grok-3-mini",
    )
    add_if_present(
        configs,
        "Perplexity",
        "openai_compatible",
        "https://api.perplexity.ai",
        env.get("PERPLEXITY_API_KEY"),
        "sonar",
    )
    add_if_present(
        configs,
        "Azure Foundry",
        "azure_openai",
        env.get("AZURE_AI_FOUNDRY_NANO_API_BASE"),
        env.get("AZURE_AI_FOUNDRY_API_KEY"),
        "cc-litellm-chat-latest",
        env.get("AZURE_AI_FOUNDRY_API_VERSION", ""),
    )
    add_if_present(
        configs,
        "Azure AI",
        "azure_openai",
        env.get("AZURE_AI_API_BASE"),
        env.get("AZURE_AI_API_KEY"),
        env.get("AZURE_AI_DEPLOYMENT") or "cc-litellm-chat-latest",
        env.get("AZURE_AI_API_VERSION") or env.get("AZURE_AI_FOUNDRY_API_VERSION", ""),
    )
    deduped: list[dict] = []
    seen: set[tuple[str, str, str, str]] = set()
    for config in configs:
        key = (config["provider"], config["base_url"].rstrip("/"), config["model"], config["api_version"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(config)
    return deduped


def redact_config(config: dict) -> dict:
    return {
        key: ("<redacted>" if key == "api_key" and value else value)
        for key, value in config.items()
    } | {"api_key_present": bool(config.get("api_key"))}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--env-file",
        action="append",
        default=[],
        help="Optional local env file. May be repeated; never commit these files.",
    )
    parser.add_argument("--write-config", help="Optional path for redacted provider configs. Secret values are never written.")
    parser.add_argument(
        "--write-config-mode",
        choices=["working", "available"],
        default="working",
        help="Write only smoke-passing providers or every provider with a local key/base/model.",
    )
    args = parser.parse_args()

    env = load_env([Path(value).expanduser() for value in args.env_file])
    working: list[dict] = []
    test_openai_compatible(working, "OpenAI", "https://api.openai.com/v1", env.get("OPENAI_API_KEY"), ["gpt-5.4-mini", "gpt-4o-mini", "gpt-4.1-mini"])
    test_openai_compatible(
        working,
        "OpenRouter",
        "https://openrouter.ai/api/v1",
        env.get("OPENROUTER_API_KEY"),
        ["google/gemma-4-26b-a4b-it:free", "meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-oss-20b:free"],
        {"HTTP-Referer": "https://utopia.local", "X-Title": "Utopia"},
    )
    test_openai_compatible(
        working,
        "Gemini",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        env.get("GEMINI_API_KEY") or env.get("GOOGLE_API_KEY"),
        ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
    )
    test_anthropic(working, env.get("ANTHROPIC_API_KEY"))
    test_openai_compatible(working, "Z.ai", "https://api.z.ai/api/coding/paas/v4", env.get("ZAI_API_KEY"), ["glm-5.1", "glm-4.6"])
    test_openai_compatible(working, "Groq", "https://api.groq.com/openai/v1", env.get("GROQ_API_KEY"), ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"])
    test_openai_compatible(working, "xAI", "https://api.x.ai/v1", env.get("XAI_API_KEY") or env.get("GROK_API_KEY"), ["grok-4", "grok-3-mini"])
    test_openai_compatible(working, "Perplexity", "https://api.perplexity.ai", env.get("PERPLEXITY_API_KEY"), ["sonar-pro", "sonar"])
    test_azure(
        working,
        "Azure Foundry",
        env.get("AZURE_AI_FOUNDRY_NANO_API_BASE"),
        env.get("AZURE_AI_FOUNDRY_API_KEY"),
        env.get("AZURE_AI_FOUNDRY_API_VERSION"),
        ["cc-litellm-chat-latest", "gpt-54-nano"],
    )

    if args.write_config:
        output = Path(args.write_config)
        configs_to_write = working if args.write_config_mode == "working" else available_provider_configs(env)
        output.write_text(json.dumps([redact_config(config) for config in configs_to_write]))
        os.chmod(output, 0o600)
        print(f"working_configs={len(working)} available_configs={len(available_provider_configs(env))} saved={output}")
    else:
        print(f"working_configs={len(working)}")
    return 0 if working else 1


if __name__ == "__main__":
    raise SystemExit(main())
