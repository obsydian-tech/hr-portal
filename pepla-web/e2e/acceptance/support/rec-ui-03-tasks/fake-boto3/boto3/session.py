"""Fake boto3.session for the REC-UI-03 feedback-due backfill test (copied from support/rec-06.2/fake-boto3). See __init__.py."""
from . import client as _client, resource as _resource


class Session:
    def __init__(self, *args, profile_name=None, region_name=None, **kwargs):
        self.profile_name, self.region_name = profile_name, region_name

    def client(self, service_name, region_name=None, **kwargs):
        return _client(service_name, region_name=region_name or self.region_name)

    def resource(self, service_name, region_name=None, **kwargs):
        return _resource(service_name, region_name=region_name or self.region_name)
