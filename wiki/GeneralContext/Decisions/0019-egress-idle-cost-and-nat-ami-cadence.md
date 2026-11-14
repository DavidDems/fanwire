---
type: decision
---

# 0019 - Egress, idle cost and NAT AMI cadence

Decision: 2026-09-21 (egress and idle cost) and 2026-10-02 (NAT AMI cadence),
the human.

## Context

The Lambdas run inside the VPC because they reach RDS, and some of them also
call out of it: Cognito's JWKS and other AWS APIs (and, when this was decided,
the sports-data provider). A function in a VPC has no egress unless something
provides it. A NAT Gateway and VPC interface endpoints both bill by the hour
whatever the traffic, and at fanwire's traffic that hourly charge would be most
of the bill.

## Choice

- **A NAT instance, not a NAT Gateway.** One small instance gives the VPC its
  egress.
- **No VPC interface endpoints.** Apart from the free gateway endpoints (S3,
  DynamoDB), every AWS API call and all internet egress go through the NAT
  instance.
- **An idle infrastructure cost of about $35 a month is accepted.** The budget
  alert that guards the bill is
  [0x00c "AWS Budgets"](../../CodeContext/Modules/0x00c-architecture-aws-account.md).
- **The NAT instance's AMI is upgraded on security advisories only**, with no
  schedule.

## Consequences

- The egress design is
  [0x00a "Egress"](../../CodeContext/Modules/0x00a-architecture-infra.md), and
  the rejected alternatives are
  [aws-stack.md](../../CodeContext/Standards/aws-stack.md) "Explicitly rejected
  at this scale".
- The NAT instance is the one egress path, so an in-VPC function that needs the
  internet or a non-gateway AWS API fails when the instance does.
- An AMI upgrade replaces the instance. Which advisories call for one, and the
  procedure, are
  [build-deployment-nat-ami.md](../../CodeContext/Standards/build-deployment-nat-ami.md).
