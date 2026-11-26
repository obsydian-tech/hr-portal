"""Fake boto3.dynamodb.types: AttributeValue to and from plain values (S, N, BOOL, NULL, M, L, SS). See ../__init__.py."""
from decimal import Decimal


class TypeSerializer:
    def serialize(self, v):
        if v is None:
            return {"NULL": True}
        if isinstance(v, bool):
            return {"BOOL": v}
        if isinstance(v, (int, float, Decimal)):
            return {"N": str(v)}
        if isinstance(v, str):
            return {"S": v}
        if isinstance(v, dict):
            return {"M": {k: self.serialize(x) for k, x in v.items()}}
        if isinstance(v, (list, tuple)):
            return {"L": [self.serialize(x) for x in v]}
        if isinstance(v, set):
            return {"SS": sorted(v)}
        raise TypeError(f"fake boto3: cannot serialize {type(v).__name__}")


class TypeDeserializer:
    def deserialize(self, av):
        (kind, v), = av.items()
        if kind == "S":
            return v
        if kind == "N":
            return Decimal(v)
        if kind == "BOOL":
            return v
        if kind == "NULL":
            return None
        if kind == "M":
            return {k: self.deserialize(x) for k, x in v.items()}
        if kind == "L":
            return [self.deserialize(x) for x in v]
        if kind == "SS":
            return set(v)
        raise TypeError(f"fake boto3: cannot deserialize {kind}")
