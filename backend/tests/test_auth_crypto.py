from app.core.auth import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)


def test_password_hashing():
    hashed = hash_password("secret")
    assert hashed != "secret"
    assert verify_password("secret", hashed) is True


def test_access_token_round_trip():
    token = create_access_token({"sub": "user-1"})
    payload = decode_access_token(token)
    assert payload["sub"] == "user-1"


def test_refresh_token_hashing():
    token = generate_refresh_token()
    token_hash = hash_refresh_token(token)
    assert token_hash != token
    assert hash_refresh_token(token) == token_hash
