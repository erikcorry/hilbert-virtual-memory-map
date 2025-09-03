# Memory Map Generator Makefile

# Find all .txt files for web server usage
TXT_FILES := $(wildcard *.txt)

# Default target: show help
default: list

# Setup dependencies for newly checked out repo
setup: node_modules

# Install Node.js dependencies
node_modules: package.json
	npm install
	@touch node_modules

# Start web server (no PNG generation)
all: node_modules
	@echo "Web server mode only - no PNG files generated"
	@echo "To start server: node index.js <input-file>"

# Clean dependencies
clean:
	rm -rf node_modules

# Show available targets
list:
	@echo "Available targets:"
	@echo "  setup     - Install Node.js dependencies (run this first on new checkout)"
	@echo "  all       - Show web server usage info"
	@echo "  clean     - Remove node_modules"
	@echo "  list      - Show this help"
	@echo ""
	@echo "Input files found:"
	@for file in $(TXT_FILES); do echo "  $$file (for web server: node index.js $$file)"; done

.PHONY: default all clean list setup