"""Fake botocore.exceptions for the REC-06.2 back-fill test. See ../boto3/__init__.py."""


class BotoCoreError(Exception):
    pass


class NoCredentialsError(BotoCoreError):
    pass


class ProfileNotFound(BotoCoreError):
    pass


class ClientError(Exception):
    def __init__(self, error_response, operation_name):
        self.response = error_response
        self.operation_name = operation_name
        err = error_response.get("Error", {})
        super().__init__(f"An error occurred ({err.get('Code')}) when calling the {operation_name} operation: {err.get('Message')}")
