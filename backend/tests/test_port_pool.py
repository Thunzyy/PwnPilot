import pytest
from app.services.port_pool import PortPool


def test_port_pool_acquire():
    pool = PortPool(range(7680, 7683))  # 3 ports
    port1 = pool.acquire()
    port2 = pool.acquire()
    assert port1 == 7680
    assert port2 == 7681
    assert pool.available_count == 1


def test_port_pool_release():
    pool = PortPool(range(7680, 7682))
    port = pool.acquire()
    pool.release(port)
    assert pool.available_count == 2


def test_port_pool_exhausted():
    pool = PortPool(range(7680, 7681))  # 1 port
    pool.acquire()
    with pytest.raises(RuntimeError, match="No available ports"):
        pool.acquire()


def test_port_pool_release_invalid():
    pool = PortPool(range(7680, 7682))
    with pytest.raises(ValueError, match="not in pool"):
        pool.release(9999)


def test_port_pool_double_release():
    pool = PortPool(range(7680, 7682))
    port = pool.acquire()
    pool.release(port)
    with pytest.raises(ValueError, match="already available"):
        pool.release(port)
