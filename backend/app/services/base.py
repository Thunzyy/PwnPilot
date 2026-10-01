"""Base service class with logging capabilities.

All services should inherit from BaseService to get:
- Structured logging bound to the service module
- Consistent logging patterns across the application
"""

from app.core.logging import get_logger


class BaseService:
    """Base class for all services.

    Provides a logger instance bound to the service module name.

    Usage:
        class MyService(BaseService):
            def __init__(self, db: AsyncSession):
                super().__init__("service.my")
                self.db = db

            async def do_something(self):
                self.log.info("Doing something", key="value")
    """

    def __init__(self, module_name: str):
        """Initialize the service with a logger.

        Args:
            module_name: Module identifier for logging (e.g., "service.project")
        """
        self.log = get_logger(module_name)
        # Keep backward compatibility with services that still reference `self.logger`.
        self.logger = self.log
