"""Fake boto3.dynamodb.conditions: not supported. The back-fill test answers string expressions only (see ../__init__.py)."""
raise ImportError("fake boto3: boto3.dynamodb.conditions is not supported; write the expressions as strings")
