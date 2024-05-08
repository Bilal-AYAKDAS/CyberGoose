from googleapiclient.discovery import build
from google.oauth2 import service_account

# Set the path to your service account credentials JSON file
SERVICE_ACCOUNT_FILE = '/path/to/service_account_credentials.json'

# Define the scopes for accessing Google Drive API
SCOPES = ['https://www.googleapis.com/auth/drive']

def create_drive_service():
    """Create a Google Drive service instance using service account credentials."""
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    service = build('drive', 'v3', credentials=credentials)
    return service

def list_files():
    """List all files in the Google Drive."""
    service = create_drive_service()
    results = service.files().list().execute()
    files = results.get('files', [])
    if not files:
        print('No files found.')
    else:
        print('Files:')
        for file in files:
            print(f'{file["name"]} ({file["id"]})')

def upload_file(file_path, parent_folder_id=None):
    """Upload a file to Google Drive."""
    service = create_drive_service()
    file_metadata = {'name': file_path.split('/')[-1]}
    if parent_folder_id:
        file_metadata['parents'] = [parent_folder_id]
    media = MediaFileUpload(file_path)
    file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
    print(f'File uploaded: {file["id"]}')

def download_file(file_id, destination_path):
    """Download a file from Google Drive."""
    service = create_drive_service()
    request = service.files().get_media(fileId=file_id)
    fh = io.FileIO(destination_path, 'wb')
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
        print(f'Download progress: {int(status.progress() * 100)}%')
    print(f'File downloaded: {destination_path}')

def delete_file(file_id):
    """Delete a file from Google Drive."""
    service = create_drive_service()
    service.files().delete(fileId=file_id).execute()
    print(f'File deleted: {file_id}')

# Example usage
list_files()
upload_file('/path/to/file.txt')
download_file('file_id', '/path/to/destination/file.txt')
delete_file('file_id')