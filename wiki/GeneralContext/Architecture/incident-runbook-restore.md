---
type: runbook
---

# Incident Runbook: restore the database

Part of the [Incident Runbook](incident-runbook.md).

## Restore the database

RDS keeps 7 days of automated backups (`Fanwire-Data`, `backupRetention`). A backup nobody has restored
proves nothing, so this is a drill: restore the latest point to a **temporary** instance, count rows, delete
it. Production is never touched. The restored instance is the same `db.t4g.micro`, encrypted with the same
CMK, in the same data subnets.

**Cost: one `db.t4g.micro` and 20 GiB of gp3 for about an hour, a few US cents.** Delete it when you're
done: a forgotten one costs about USD $15 a month.

After each drill, add a row:

| Date | Restore point | Restore started → available | Time to restore | Rows (users / posts / games) | Head revision |
|---|---|---|---|---|---|
| 2026-10-20 | Latest restorable at 15:24 UTC (step 2 read 15:05:48 UTC) | 15:24:03 → 15:44:46 UTC | 20 min 42 s | 2 / 6 / 29,646 | `a8c4e1f7b3d9` |

Two traps the steps guard against:
- **Pasted ids.** A hand-pasted temporary group id can land where the NAT group's belongs. Steps 2 and 3 set
  `$src`, `$subnets`, `$natId` and `$nat`, so no step takes a pasted id.
- **The egress revoke.** Skip it in step 13 and deleting the group fails with `DependencyViolation`.

The database is in data subnets with no route out, and its security group admits the Lambda SG only. The
drill reaches the copy through a Session Manager port forward on the NAT instance. The copy gets its own
temporary security group, so production's database stays closed throughout. The NAT security group gets a
temporary egress rule. That is drift on `Fanwire-Network` until step 13 removes it.

Every command below is one line of PowerShell in **one** window, except the port forward, which blocks and
gets a second. Run them in order. Steps 1–3 only read.

1. Sign in, then check the plugin the port forward needs (install it from AWS's docs if that fails):
   ```powershell
   aws sso login --profile fanwire-workload
   ```
   ```powershell
   session-manager-plugin --version
   ```
2. The source instance, its subnet group and the latest restorable time:
   ```powershell
   aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --query "DBInstances[].{id:DBInstanceIdentifier,subnets:DBSubnetGroup.DBSubnetGroupName,latest:LatestRestorableTime}" --output table
   ```
   Then keep the source's id and subnet group for steps 7 and 14:
   ```powershell
   $src, $subnets = (aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --query "DBInstances[0].[DBInstanceIdentifier,DBSubnetGroup.DBSubnetGroupName]" --output text) -split "\s+"; $src; $subnets
   ```
3. The NAT instance and its security group:
   ```powershell
   aws ec2 describe-instances --region ca-central-1 --profile fanwire-workload --filters "Name=tag:aws:cloudformation:stack-name,Values=Fanwire-Network" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].{id:InstanceId,sg:SecurityGroups[0].GroupId}" --output table
   ```
   Then keep both. `$nat` is the NAT's **security group** (`sg-…`), and `$natId` is the instance (`i-…`):
   ```powershell
   $natId, $nat = (aws ec2 describe-instances --region ca-central-1 --profile fanwire-workload --filters "Name=tag:aws:cloudformation:stack-name,Values=Fanwire-Network" "Name=instance-state-name,Values=running" --query "Reservations[0].Instances[0].[InstanceId,SecurityGroups[0].GroupId]" --output text) -split "\s+"; $natId; $nat
   ```
4. A temporary security group for the copy. `$sg` holds its id for the steps below:
   ```powershell
   $sg = aws ec2 create-security-group --region ca-central-1 --profile fanwire-workload --vpc-id vpc-0259c7c65d0a58371 --group-name fanwire-restore-drill --description "Temporary: database restore drill. Delete after." --query GroupId --output text; $sg
   ```
5. Let the NAT instance in (on the temporary group only). In the output, `GroupId` is `$sg` and
   `ReferencedGroupInfo` is `$nat`:
   ```powershell
   aws ec2 authorize-security-group-ingress --region ca-central-1 --profile fanwire-workload --group-id $sg --protocol tcp --port 5432 --source-group $nat
   ```
6. Let the NAT instance out to it. In the output, `GroupId` is `$nat`:
   ```powershell
   aws ec2 authorize-security-group-egress --region ca-central-1 --profile fanwire-workload --group-id $nat --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$sg}]"
   ```
7. **Start the clock and restore.** Note the time this prints:
   ```powershell
   Get-Date -Format o; aws rds restore-db-instance-to-point-in-time --region ca-central-1 --profile fanwire-workload --source-db-instance-identifier $src --target-db-instance-identifier fanwire-restore-drill --use-latest-restorable-time --db-instance-class db.t4g.micro --db-subnet-group-name $subnets --vpc-security-group-ids $sg --no-multi-az --no-publicly-accessible --no-deletion-protection --query "DBInstance.DBInstanceStatus" --output text
   ```
8. **Wait, and stop the clock.** The waiter gives up after 30 minutes. If it prints `Max attempts exceeded`,
   run the line again. The second time it prints is the end of the restore:
   ```powershell
   aws rds wait db-instance-available --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill; Get-Date -Format o
   ```
9. The copy's endpoint. The second line prints step 10's command with every id filled in. Copy it:
   ```powershell
   $endpoint = aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill --query "DBInstances[0].Endpoint.Address" --output text; $endpoint
   ```
   ```powershell
   "aws ssm start-session --region ca-central-1 --profile fanwire-workload --target $natId --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters `"host=$endpoint,portNumber=5432,localPortNumber=15432`""
   ```
10. **In a second window**, paste and run the command step 9 printed. It prints `Waiting for connections...`
    and then **never returns**: that is the open tunnel, working. Leave it running and go back to the first
    window. Step 13 stops it.
11. Back in the first window, put the master password in this window's environment without printing it. The
    secret is `Fanwire-Data`'s `FanwireDataPostgresSecret…`. The restored copy has the same password as production:
    ```powershell
    $env:PGPASSWORD = (aws secretsmanager get-secret-value --region ca-central-1 --profile fanwire-workload --secret-id (aws cloudformation describe-stack-resources --region ca-central-1 --profile fanwire-workload --stack-name Fanwire-Data --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret' && contains(LogicalResourceId, 'PostgresSecret')].PhysicalResourceId | [0]" --output text) --query SecretString --output text | ConvertFrom-Json).password
    ```
12. **Count rows** with the Postgres client in Docker (no local install needed). Non-zero counts and a head
    revision equal to the newest file in `backend/alembic/versions/` mean the restore holds real data:
    ```powershell
    docker run --rm -e PGPASSWORD postgres:16 psql -h host.docker.internal -p 15432 -U fanwire_admin -d fanwire -c "select (select count(*) from users) as users, (select count(*) from posts) as posts, (select count(*) from games) as games, (select version_num from alembic_version) as head;"
    ```
13. **Clean up, in this order.** Stop the port forward with Ctrl+C in the second window. Then forget the password,
    delete the copy (the identifier is the copy's, never the source's; production also has deletion
    protection), wait for it to go, and remove both network changes:
    ```powershell
    Remove-Item Env:PGPASSWORD
    ```
    ```powershell
    aws rds delete-db-instance --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill --skip-final-snapshot --delete-automated-backups
    ```
    ```powershell
    aws rds wait db-instance-deleted --region ca-central-1 --profile fanwire-workload --db-instance-identifier fanwire-restore-drill
    ```
    ```powershell
    aws ec2 revoke-security-group-egress --region ca-central-1 --profile fanwire-workload --group-id $nat --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$sg}]"
    ```
    ```powershell
    aws ec2 delete-security-group --region ca-central-1 --profile fanwire-workload --group-id $sg
    ```
    `DependencyViolation` on the last line means the egress rule above is still in place: run the revoke, then
    the delete again.
14. **Check nothing is left.** The first command should list the production instance only, the second
    nothing, and the third only the 443 rules (no 5432 left on the NAT group):
    ```powershell
    aws rds describe-db-instances --region ca-central-1 --profile fanwire-workload --query "DBInstances[].DBInstanceIdentifier" --output text
    ```
    ```powershell
    aws ec2 describe-security-groups --region ca-central-1 --profile fanwire-workload --filters "Name=group-name,Values=fanwire-restore-drill" --query "SecurityGroups[].GroupId" --output text
    ```
    ```powershell
    aws ec2 describe-security-group-rules --region ca-central-1 --profile fanwire-workload --filters "Name=group-id,Values=$nat" --query "SecurityGroupRules[].[IsEgress,FromPort,ReferencedGroupInfo.GroupId,CidrIpv4]" --output text
    ```
15. Add a row to the table above: the date, the restore point (step 2's `latest`), the two times from steps 7 and 8
    and the difference between them, the counts and the head revision from step 12.

**If the port forward fails** (`TargetNotConnected`, or the session opens and psql times out): the NAT
instance's SSM agent must be online, and steps 5 and 6 must both be in place. Check the agent with:

```powershell
aws ssm describe-instance-information --region ca-central-1 --profile fanwire-workload --output table
```

You can skip the row count and still record the time-to-restore. That is the number this drill is mainly
for. Clean up as in step 13 either way.
