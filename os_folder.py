import os
from datetime import datetime


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

def close_folder():
    pass
def edit_file():
    pass

#if __name__ == '__main__':
#   directory_path = "C:\\Users\\bilalayakdas\\Desktop\\FtpDirectory"
#   print(File_Operatipons.list_files(directory_path))
    #File_Operatipons.open_folder(directory_path,"new")