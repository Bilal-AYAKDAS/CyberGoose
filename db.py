import sqlite3
import json
class DbMyFtp:

    def __init__(self):
        pass
        
    def selectBookMarks(self):
        connection = sqlite3.connect("data.db")
        cursor = connection.cursor()
        cursor.execute("""SELECT CONNECTION_TYPE, ID, HOSTNAME, PORT, USERNAME, PASSWORD 
                        FROM BOOKMARKS 
                        WHERE ID = (SELECT MAX(ID) FROM BOOKMARKS)""")
        row = cursor.fetchone()  # Tek bir kayıt almak için fetchone() kullanılır.
        connection.close()
        
        if row:
            data = {
                "CONNECTION_TYPE": row[0],
                "ID": row[1],
                "HOSTNAME": row[2],
                "PORT": row[3],
                "USERNAME": row[4],
                "PASSWORD": row[5]
            }
            return data
        else:
            return None  # Eğer sonuç yoksa, None döndür.

    def selectLocalBookMarks(self):
        connection = sqlite3.connect("data.db")
        cursor = connection.cursor()
        cursor.execute("""SELECT PATH FROM local_bookmarks 
                          WHERE ID = (SELECT MAX(ID) FROM local_bookmarks)""")
        row = cursor.fetchone()  # Tek bir kayıt almak için fetchone() kullanılır.
        connection.close()
        if row:
            
            data = {
                "PATH": row[0]
            }
            return data
        else:
            return None  # Eğer sonuç yoksa, None döndür.
        
        

    def insertBookMarks(self,hostname,port,username,password):
        connection = sqlite3.connect("data.db")
        sql = "INSERT INTO BOOKMARKS (HOSTNAME,PORT,USERNAME,PASSWORD ) VALUES (?,?,?,?)"
        values = (hostname,port,username,password)    
        connection.execute(sql,values)
        connection.commit()
        connection.close()
        
    def updateBookMarks(self, id, new_hostname, new_port, new_username, new_password):
        connection = sqlite3.connect("data.db")
        sql = "UPDATE BOOKMARKS SET HOSTNAME = ?, PORT = ?, USERNAME = ?, PASSWORD = ? WHERE ID = ?"
        values = (new_hostname, new_port, new_username, new_password, id)    
        connection.execute(sql, values)
        connection.commit()
        connection.close()
            
    def deleteBookMarks(self, id):
        connection = sqlite3.connect("data.db")
        sql = "DELETE FROM BOOKMARKS WHERE ID = ?"
        values = (id,)    
        connection.execute(sql, values)
        connection.commit()
        connection.close()

        

    
        
db = DbMyFtp()        
if __name__ == '__main__':
    #db.deleteBookMarks()
    #db.insertBookMarks("hkljnjk","21","kbnljnlk","passs")
 #   db.updateBookMarks(id=4,new_hostname="bbbb",new_port="21",new_username="bb",new_password="bbbb")
   print(db.selectLocalBookMarks())

