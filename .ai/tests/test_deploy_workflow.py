"""The deploy workflow, and the boundary between it and the agent workflows.

`.ai/docs/handoff.md` §5.7: the pipeline that runs AI agents must not be able
to reach AWS. A standalone deploy workflow is allowed, so that boundary has to
be a property of the files rather than a sentence about them:

- `GitHubActionsDeployRole` trusts one GitHub *environment*, `production`, not
  a branch. A branch-scoped trust (`ref:refs/heads/main`) admits every workflow
  run from `main`, and the agent workflows run from `main` too.
- Only the deploy job declares that environment, and only it may request an
  OIDC token. No other workflow names the deploy workflow.

Plain text checks, no YAML parser: `.ai/` stays stdlib-only.
"""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
DEPLOY = WORKFLOWS / "deploy.yml"
TRUST = ROOT / "infra" / "iam" / "github-actions-deploy-role-trust-policy.json"
CDK_IMAGE = ROOT / "docker" / "cdk-deploy.Dockerfile"

ROLE_ARN = "arn:aws:iam::294321867941:role/GitHubActionsDeployRole"
OIDC_PROVIDER = "arn:aws:iam::294321867941:oidc-provider/token.actions.githubusercontent.com"
ENVIRONMENT_SUB = "repo:DavidDems/fanwire:environment:production"


def _code_lines(text: str) -> list[str]:
    """Lines that are not YAML comments, with their indentation kept."""
    return [line for line in text.splitlines() if not line.lstrip().startswith("#")]


def _block(lines: list[str], key: str) -> list[str]:
    """The lines under a top-level `key:` up to the next top-level key."""
    start = lines.index(f"{key}:")
    out = []
    for line in lines[start + 1 :]:
        if line and not line[0].isspace():
            break
        out.append(line)
    return out


@pytest.fixture
def deploy() -> list[str]:
    assert DEPLOY.exists(), "the deploy workflow is .github/workflows/deploy.yml"
    return _code_lines(DEPLOY.read_text(encoding="utf-8"))


def _other_workflows() -> list[Path]:
    return sorted(p for p in WORKFLOWS.glob("*.yml") if p.name != DEPLOY.name)


class TestOnlyTheDeployJobCanAssumeTheRole:
    @pytest.mark.parametrize("path", _other_workflows(), ids=lambda p: p.name)
    def test_no_other_workflow_requests_an_oidc_token(self, path):
        text = "\n".join(_code_lines(path.read_text(encoding="utf-8")))
        assert "id-token" not in text, (
            f"{path.name} requests an OIDC token; only the deploy job may"
        )

    @pytest.mark.parametrize("path", _other_workflows(), ids=lambda p: p.name)
    def test_no_other_workflow_declares_an_environment(self, path):
        for line in _code_lines(path.read_text(encoding="utf-8")):
            assert not line.strip().startswith("environment:"), (
                f"{path.name} declares an environment; the role trusts `production`"
            )

    @pytest.mark.parametrize("path", _other_workflows(), ids=lambda p: p.name)
    def test_no_other_workflow_names_the_deploy_workflow(self, path):
        text = "\n".join(_code_lines(path.read_text(encoding="utf-8")))
        assert "deploy.yml" not in text

    def test_the_deploy_job_runs_in_the_production_environment(self, deploy):
        assert "    environment: production" in deploy

    def test_the_token_is_requested_once_and_by_the_job(self, deploy):
        token_lines = [line for line in deploy if "id-token" in line]
        assert len(token_lines) == 1
        assert token_lines[0].strip() == "id-token: write"
        # Indented under `jobs.<id>.permissions`, not the workflow-level block.
        assert token_lines[0].startswith("      ")
        assert not any("id-token" in line for line in _block(deploy, "permissions"))

    def test_the_workflow_level_token_is_read_only(self, deploy):
        top = [line.strip() for line in _block(deploy, "permissions") if line.strip()]
        assert top == ["contents: read"]

    def test_it_assumes_the_deploy_role(self, deploy):
        assert any(ROLE_ARN in line for line in deploy)


class TestTheTrustPolicy:
    @pytest.fixture
    def policy(self) -> dict:
        assert TRUST.exists(), "the trust policy is committed beside the permissions policy"
        return json.loads(TRUST.read_text(encoding="utf-8"))

    def test_one_statement_for_web_identity_from_githubs_provider(self, policy):
        (statement,) = policy["Statement"]
        assert statement["Effect"] == "Allow"
        assert statement["Action"] == "sts:AssumeRoleWithWebIdentity"
        assert statement["Principal"] == {"Federated": OIDC_PROVIDER}

    def test_the_subject_is_the_environment_not_a_branch(self, policy):
        (statement,) = policy["Statement"]
        assert statement["Condition"] == {
            "StringEquals": {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": ENVIRONMENT_SUB,
            }
        }

    def test_no_wildcard_matching_anywhere(self, policy):
        text = json.dumps(policy)
        assert "StringLike" not in text
        assert "*" not in text


class TestTheDeployWorkflowShape:
    def test_it_is_dispatched_by_hand_only(self, deploy):
        triggers = {
            line.strip().rstrip(":")
            for line in _block(deploy, "on")
            if re.match(r"^  [a-z_]+:", line)
        }
        assert triggers == {"workflow_dispatch"}

    def test_two_deploys_never_overlap(self, deploy):
        assert any(line.strip() == "cancel-in-progress: false" for line in deploy)
        assert not any(line.strip() == "cancel-in-progress: true" for line in deploy)
        assert any(
            line.startswith("concurrency:") or line.strip() == "concurrency:" for line in deploy
        )

    def test_the_job_declares_a_timeout(self, deploy):
        assert any(line.strip().startswith("timeout-minutes:") for line in deploy)

    def test_the_cli_comes_from_the_pinned_image(self, deploy):
        text = "\n".join(deploy)
        assert "docker/cdk-deploy.Dockerfile" in text
        assert "npx cdk" not in text
        assert "npx aws-cdk" not in text
        assert "npm install -g" not in text

    def test_diff_runs_before_deploy(self, deploy):
        diff = [i for i, line in enumerate(deploy) if re.search(r"fanwire-cdk\S*\s+diff\b", line)]
        dep = [
            i
            for i, line in enumerate(deploy)
            if re.search(r"fanwire-cdk\S*\s+deploy --all\b", line)
        ]
        assert diff and dep, "expected `<fanwire-cdk image> diff` and `<image> deploy --all`"
        assert max(diff) < min(dep)

    def test_deploy_does_not_wait_for_an_answer_ci_cannot_give(self, deploy):
        (line,) = [line for line in deploy if re.search(r"fanwire-cdk\S*\s+deploy --all\b", line)]
        assert "--require-approval never" in line

    def test_every_cdk_call_keeps_the_frontend_deployment(self, deploy):
        """Without the flag, a deploy of Fanwire-Cdn removes the live
        BucketDeployment, and a diff without it shows that removal."""
        calls = [line for line in deploy if re.search(r"fanwire-cdk\S*\s+(diff|deploy)\b", line)]
        assert calls
        for line in calls:
            assert "-c deployFrontend=true" in line, line

    def test_the_bundle_is_built_in_docker(self, deploy):
        text = "\n".join(deploy)
        assert "docker/frontend.Dockerfile" in text
        assert "--target export" in text
        assert "npm run build" not in text

    @pytest.mark.parametrize(
        "forbidden",
        [
            "FanwireCdkCfnExecPolicy",
            "create-policy-version",
            "set-default-policy-version",
            "cdk-cfn-exec-role-policy",
            "bootstrap",
            "lambda invoke",
            "gh pr merge",
            "--approve",
        ],
    )
    def test_it_never_touches_what_a_human_owns(self, deploy, forbidden):
        assert forbidden not in "\n".join(deploy)


class TestThePinnedImageCanBuildTheBackendAsset:
    """`Fanwire-App`'s `DockerImageAsset` is built at deploy time, so the CLI
    has to be able to call `docker build` from inside its own container."""

    def test_the_image_has_a_docker_client(self):
        text = CDK_IMAGE.read_text(encoding="utf-8")
        assert "docker-cli" in text
        assert "docker-cli-buildx" in text
