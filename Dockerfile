FROM python:3.10-slim

WORKDIR /code

COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY . /code

# Render asigna automáticamente el puerto en la variable $PORT
CMD uvicorn main:app --host 0.0.0.0 --port $PORT