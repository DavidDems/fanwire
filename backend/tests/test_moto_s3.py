import boto3
from moto import mock_aws


@mock_aws
def test_moto_mocks_s3_bucket_creation():
    client = boto3.client("s3", region_name="us-east-1")
    client.create_bucket(Bucket="fanwire-test-bucket")

    buckets = client.list_buckets()["Buckets"]

    assert any(bucket["Name"] == "fanwire-test-bucket" for bucket in buckets)
