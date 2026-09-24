from functools import lru_cache

from opensearchpy import OpenSearch

from app.config import get_settings

settings = get_settings()

PERSON_INDEX_MAPPING = {
    "mappings": {
        "properties": {
            "person_id": {"type": "keyword"},
            "first_name": {"type": "text"},
            "last_name": {"type": "text"},
            "full_name": {"type": "text"},
            "cities": {"type": "keyword"},
            "states": {"type": "keyword"},
            "age_estimate": {"type": "integer"},
        }
    }
}


@lru_cache
def get_opensearch_client() -> OpenSearch:
    return OpenSearch(hosts=[settings.opensearch_url], use_ssl=settings.opensearch_url.startswith("https"))


def ensure_index() -> None:
    client = get_opensearch_client()
    if not client.indices.exists(index=settings.opensearch_index):
        client.indices.create(index=settings.opensearch_index, body=PERSON_INDEX_MAPPING)


def index_person(person_id: str, first_name: str, last_name: str, cities: list[str], states: list[str],
                  age_estimate: int | None) -> None:
    client = get_opensearch_client()
    client.index(
        index=settings.opensearch_index,
        id=person_id,
        body={
            "person_id": person_id,
            "first_name": first_name,
            "last_name": last_name,
            "full_name": f"{first_name} {last_name}",
            "cities": cities,
            "states": states,
            "age_estimate": age_estimate,
        },
        refresh=True,
    )


def search_persons(first_name: str, last_name: str, state: str | None = None, city: str | None = None,
                    size: int = 25) -> list[str]:
    client = get_opensearch_client()
    must = [
        {"match": {"first_name": {"query": first_name, "fuzziness": "AUTO"}}},
        {"match": {"last_name": {"query": last_name, "fuzziness": "AUTO"}}},
    ]
    filters = []
    if state:
        filters.append({"term": {"states": state.upper()}})
    if city:
        filters.append({"term": {"cities": city.lower()}})

    query = {"query": {"bool": {"must": must, "filter": filters}}, "size": size}
    response = client.search(index=settings.opensearch_index, body=query)
    return [hit["_source"]["person_id"] for hit in response["hits"]["hits"]]
