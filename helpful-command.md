echo "# Codebase" > codebase.md
find src -type f -name '\*.ts' | sort | while read -r file; do
echo -e "\n## $file\n" >> codebase.md
  echo '' >> codebase.md
  cat "$file" >> codebase.md
echo '```' >> codebase.md
done
