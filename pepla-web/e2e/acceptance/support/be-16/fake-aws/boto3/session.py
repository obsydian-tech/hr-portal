"""Fake boto3.session for BE-16 acceptance tests. See __init__.py."""
from . import client as _client


class Session:
    def __init__(self, *args, region_name=None, **kwargs):
        self.region_name = region_name

    def client(self, service_name, region_name=None, **kwargs):
        return _client(service_name, region_name=region_name or self.region_name)

    def resource(self, *args, **kwargs):
        raise RuntimeError("fake boto3: resource() is not supported")
