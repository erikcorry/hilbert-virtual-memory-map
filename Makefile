# Memory Map Generator Makefile

# Find all .txt files and generate corresponding .png targets
TXT_FILES := $(wildcard *.txt)
PNG_FILES := $(TXT_FILES:.txt=.png)

# Default target: show help
default: list

# Setup dependencies for newly checked out repo
setup: node_modules

# Install Node.js dependencies
node_modules: package.json
	npm install
	@touch node_modules

# Generate all PNGs
all: node_modules $(PNG_FILES)

# Rule to generate PNG from TXT file
%.png: %.txt index.js node_modules
	node index.js $< $@

# Clean generated PNG files
clean:
	rm -f *.png

# Clean everything including dependencies
clean-all: clean
	rm -rf node_modules

# Show available targets
list:
	@echo "Available targets:"
	@echo "  setup     - Install Node.js dependencies (run this first on new checkout)"
	@echo "  all       - Generate all PNG files from TXT files"
	@echo "  clean     - Remove all generated PNG files"
	@echo "  clean-all - Remove PNG files and node_modules"
	@echo "  list      - Show this help"
	@echo ""
	@echo "Input files found:"
	@for file in $(TXT_FILES); do echo "  $$file -> $${file%.txt}.png"; done

.PHONY: default all clean clean-all list setup