import hashlib
import mimetypes
import os
from datetime import datetime
from pathlib import Path

MAX_PREVIEW_BYTES = 64 * 1024
TEXT_EXTENSIONS = {
    ".cfg", ".css", ".csv", ".html", ".ini", ".js", ".json", ".log",
    ".md", ".py", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}


def list_files(directory):
    dosya_dict_listesi = []
    i = 0
    for file in os.listdir(directory):
        i = i + 1
        item_path = os.path.join(directory, file)
        modification_time = os.path.getmtime(item_path)
        formatted_time = datetime.fromtimestamp(modification_time).strftime('%d %b %Y %H:%M')
        file_size =os.path.getsize(item_path)
        dosya_dict = {"Sira":i,"FileName": file, "TimeStamp": str(formatted_time), "Size":str(file_size)+" Byte"}
        dosya_dict_listesi.append(dosya_dict)
    return dosya_dict_listesi
        
def open_folder(now_path,directory):
    new_path = now_path+"\\"+directory
    for item in os.listdir(new_path):
        # Dosya yolu oluştur
        item_path = os.path.join(new_path, item)
        # Eğer bir klasörse, içeriğini listele
        if os.path.isdir(item_path):
            modification_time = os.path.getmtime(item_path)
            formatted_time = datetime.fromtimestamp(modification_time).strftime('%d %b %Y %H:%M')
            file_size =os.path.getsize(item_path)
            print("Klasör:", item_path)
            print(formatted_time)
            print(file_size)
            

        else:
            modification_time = os.path.getmtime(item_path)
            formatted_time = datetime.fromtimestamp(modification_time).strftime('%d %b %Y %H:%M')
            file_size =os.path.getsize(item_path)
            print("Klasör:", item_path)
            print(formatted_time)
            print(file_size)

def show_file(file_path):
    content_of_file = dict()
    i = 0
    with open(file_path, 'r') as file:
        for line in file:
            print(line.strip())
            content_of_file[i]=line.strip()
            i = i + 1
    return content_of_file

def save_file(file_path, content):
    with open(file_path, 'w') as file:
        file.write(content)
    return True

def delete_file(file_path):
    os.remove(file_path)
    return True


def inspect_file(file_path):
    path = Path(file_path).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(str(path))
    if not path.is_file():
        raise IsADirectoryError(str(path))

    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)

    mime_type, _ = mimetypes.guess_type(path.name)
    is_text = path.suffix.lower() in TEXT_EXTENSIONS or bool(mime_type and mime_type.startswith("text/"))
    preview = None
    preview_truncated = False
    if is_text:
        with path.open("rb") as file:
            content = file.read(MAX_PREVIEW_BYTES + 1)
        preview_truncated = len(content) > MAX_PREVIEW_BYTES
        preview = content[:MAX_PREVIEW_BYTES].decode("utf-8", errors="replace")

    stat = path.stat()
    return {
        "FileName": path.name,
        "FilePath": str(path),
        "Type": "File",
        "Size": stat.st_size,
        "Change": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "filemod": oct(stat.st_mode)[-3:],
        "sha256": digest.hexdigest(),
        "preview": preview,
        "previewTruncated": preview_truncated,
    }

#if __name__ == '__main__':
#   directory_path = "C:\\Users\\bilalayakdas\\Desktop\\FtpDirectory"
#   print(File_Operatipons.list_files(directory_path))
    #File_Operatipons.open_folder(directory_path,"new")