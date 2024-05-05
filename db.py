import sqlite3

class DbMyFtp:

    def __init__(self):
        pass
        
    def selectBookMarks(self):        
        connection = sqlite3.connect("data.db")
        cursor = connection.execute("""SELECT ID,
                                              HOSTNAME,
                                              PORT,
                                              USERNAME,
                                              PASSWORD 
                                              FROM BOOKMARKS""")
                
        for row in cursor:
            print("ID = "+str(row[0]))
            print("HOSTNAME = "+row[1])
            print("*********")
        
        connection.close()

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

        

    
        
#db = DbMyFtp()        
#if __name__ == '__main__':
    #db.deleteBookMarks()
    #db.insertBookMarks("hkljnjk","21","kbnljnlk","passs")
 #   db.updateBookMarks(id=4,new_hostname="bbbb",new_port="21",new_username="bb",new_password="bbbb")
  #  db.selectBookMarks()

