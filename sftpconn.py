import paramiko

def connect_sftp(hostname, port, username, password):
    # Create an SSH client
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        # Connect to the SSH server
        client.connect(hostname, port, username, password)
        print("Connected to SFTP server successfully!")

        # Create an SFTP client
        sftp = client.open_sftp()
        return sftp

    except paramiko.AuthenticationException:
        print("Authentication failed. Please check your credentials.")
    except paramiko.SSHException as e:
        print("Unable to establish SSH connection:", str(e))
    except paramiko.SFTPException as e:
        print("Unable to establish SFTP connection:", str(e))

    return None

def upload_file(sftp, local_path, remote_path):
    try:
        # Upload a file to the remote server
        sftp.put(local_path, remote_path)
        print("File uploaded successfully!")
    except Exception as e:
        print("Failed to upload file:", str(e))

def download_file(sftp, remote_path, local_path):
    try:
        # Download a file from the remote server
        sftp.get(remote_path, local_path)
        print("File downloaded successfully!")
    except Exception as e:
        print("Failed to download file:", str(e))

def edit_file(sftp, remote_path, new_content):
    try:
        # Read the existing file content
        with sftp.open(remote_path, "r") as file:
            content = file.read()

        # Modify the file content
        content += "\n" + new_content

        # Write the modified content back to the file
        with sftp.open(remote_path, "w") as file:
            file.write(content)

        print("File edited successfully!")
    except Exception as e:
        print("Failed to edit file:", str(e))

def delete_file(sftp, remote_path):
    try:
        # Delete a file from the remote server
        sftp.remove(remote_path)
        print("File deleted successfully!")
    except Exception as e:
        print("Failed to delete file:", str(e))

# Example usage
sftp = connect_sftp("hostname", 22, "username", "password")
if sftp:
    upload_file(sftp, "local_file.txt", "remote_file.txt")
    download_file(sftp, "remote_file.txt", "local_file.txt")
    edit_file(sftp, "remote_file.txt", "New content")
    delete_file(sftp, "remote_file.txt")

    # Close the SFTP connection
    sftp.close()